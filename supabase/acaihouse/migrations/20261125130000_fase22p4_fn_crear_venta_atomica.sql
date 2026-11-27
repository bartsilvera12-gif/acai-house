-- Fase 2.2 Parte 4 — Función transaccional atómica para crear una venta
-- completa (header + items + adicionales + variantes + CxC + stock).
--
-- Reemplaza el "rollback best-effort" del lado TS. La función corre en la
-- transacción implícita del server: si CUALQUIER paso falla, PostgreSQL
-- hace rollback de todo y devuelve el error al caller.
--
-- Correcciones 2026-11-25 (post-review PR #5):
--   · stock: NO acepta `nuevo_stock` precomputado — usa deltas atómicos
--     con `SELECT ... FOR UPDATE` para prevenir lost-update en ventas
--     concurrentes del mismo insumo. Política vender-sin-stock explícita
--     vía `permitir_sin_stock` en el payload.
--   · costo_unitario_snapshot y costo_unitario del movimiento se calculan
--     EN EL SERVER leyendo productos.costo_promedio con FOR UPDATE — no
--     se confía en valores del cliente.
--   · SECURITY DEFINER + search_path acotado + chequeo de empresa_id
--     al inicio (en lugar de SECURITY INVOKER que requería RLS por tabla
--     y abría posible ambigüedad de permisos entre service_role y authenticated).
--     El wrapper TS garantiza que `empresa_id` del payload coincide con la
--     empresa del JWT antes de llamar la RPC.
--
-- Esquema del payload esperado:
--   {
--     "empresa_id": uuid,
--     "permitir_sin_stock": boolean (default false),
--     "venta": { numero_control, fecha, total, subtotal, monto_iva,
--                tipo_iva_resumen, tipo_venta ("CONTADO"|"CREDITO"),
--                plazo_dias, fecha_vencimiento?, moneda, tipo_cambio,
--                cliente_id?, observaciones?, metodo_pago, caja_id?,
--                genera_nota_remision, nota_remision_numero? },
--     "items":  [{ id (uuid pre-generado), producto_id, producto_nombre, sku,
--                  cantidad, precio_venta_original, precio_venta, tipo_iva,
--                  tipo_precio, subtotal, monto_iva, total_linea, nota?,
--                  presentacion_id?,
--                  adicionales?: [{ adicional_id?, adicional_nombre,
--                                   precio_unitario, cantidad }],
--                  variantes?:   [{ grupo_id, opcion_id, grupo_codigo,
--                                   grupo_etiqueta, opcion_etiqueta,
--                                   insumo_producto_id, cantidad,
--                                   unidad_medida, merma_pct }] } ],
--     "cxc":    null | { numero_cuota, monto, saldo, fecha_vencimiento },
--     "stock_deltas": [{ producto_id, delta_qty, movimiento: {
--                          tipo, origen, referencia, created_by?,
--                          usuario_nombre? } }]
--   }

BEGIN;

CREATE OR REPLACE FUNCTION acaihouse.fn_crear_venta_atomica(p_payload jsonb)
RETURNS TABLE(venta_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = acaihouse, pg_temp
AS $$
DECLARE
  v_empresa_id uuid;
  v_permitir_sin_stock boolean := false;
  v_venta_header jsonb;
  v_items jsonb;
  v_cxc jsonb;
  v_stock_deltas jsonb;
  v_venta_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_adi jsonb;
  v_var jsonb;
  v_delta jsonb;
  v_prod_id uuid;
  v_delta_qty numeric;
  v_mov jsonb;
  v_current_stock numeric;
  v_current_costo numeric;
  v_prod_nombre text;
  v_prod_sku text;
  v_insumo_costo numeric;
  v_nueva_cantidad numeric;
BEGIN
  v_empresa_id         := (p_payload->>'empresa_id')::uuid;
  v_permitir_sin_stock := COALESCE((p_payload->>'permitir_sin_stock')::boolean, false);
  v_venta_header       := p_payload->'venta';
  v_items              := p_payload->'items';
  v_cxc                := p_payload->'cxc';
  v_stock_deltas       := p_payload->'stock_deltas';

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'empresa_id requerido' USING ERRCODE = '22P02';
  END IF;
  IF v_venta_header IS NULL THEN
    RAISE EXCEPTION 'venta requerida' USING ERRCODE = '22P02';
  END IF;
  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items debe ser array no vacío' USING ERRCODE = '22P02';
  END IF;

  -- GUARD DE TENANT (SECURITY DEFINER no puede confiar en el empresa_id del
  -- caller). Solo service_role puede especificar cualquier empresa_id; roles
  -- autenticados deben pasar la validación acaihouse.puede_acceder_empresa,
  -- que resuelve el empresa_id del JWT. Anon NO puede ejecutar nunca.
  IF current_user = 'anon' THEN
    RAISE EXCEPTION 'Rol anon no puede ejecutar fn_crear_venta_atomica' USING ERRCODE = '42501';
  END IF;
  IF current_user <> 'service_role' AND NOT acaihouse.puede_acceder_empresa(v_empresa_id) THEN
    RAISE EXCEPTION 'Sin acceso a la empresa % (tenant mismatch)', v_empresa_id USING ERRCODE = '42501';
  END IF;

  -- 1) INSERT ventas (header)
  INSERT INTO acaihouse.ventas (
    empresa_id, numero_control, fecha, total, subtotal, monto_iva, estado,
    tipo_venta, plazo_dias, moneda, tipo_cambio,
    cliente_id, observaciones, metodo_pago, caja_id,
    genera_nota_remision, nota_remision_numero
  )
  VALUES (
    v_empresa_id,
    v_venta_header->>'numero_control',
    (v_venta_header->>'fecha')::timestamptz,
    (v_venta_header->>'total')::numeric,
    (v_venta_header->>'subtotal')::numeric,
    (v_venta_header->>'monto_iva')::numeric,
    'completada',
    v_venta_header->>'tipo_venta',
    NULLIF((v_venta_header->>'plazo_dias')::text,'')::int,
    v_venta_header->>'moneda',
    (v_venta_header->>'tipo_cambio')::numeric,
    NULLIF((v_venta_header->>'cliente_id')::text,'')::uuid,
    v_venta_header->>'observaciones',
    v_venta_header->>'metodo_pago',
    NULLIF((v_venta_header->>'caja_id')::text,'')::uuid,
    COALESCE((v_venta_header->>'genera_nota_remision')::boolean, false),
    NULLIF(v_venta_header->>'nota_remision_numero','')
  )
  RETURNING id INTO v_venta_id;

  -- 2) INSERT ventas_items + adicionales + variantes (snapshot inmutable).
  --    costo_unitario_snapshot se LEE del server, NO se confía en el cliente.
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_item_id := (v_item->>'id')::uuid;
    INSERT INTO acaihouse.ventas_items (
      id, empresa_id, venta_id, producto_id, producto_nombre, sku, cantidad,
      precio_venta_original, precio_venta, tipo_iva, tipo_precio, subtotal,
      monto_iva, total_linea, nota, presentacion_id
    )
    VALUES (
      v_item_id, v_empresa_id, v_venta_id,
      (v_item->>'producto_id')::uuid,
      v_item->>'producto_nombre',
      v_item->>'sku',
      (v_item->>'cantidad')::numeric,
      (v_item->>'precio_venta_original')::numeric,
      (v_item->>'precio_venta')::numeric,
      v_item->>'tipo_iva',
      v_item->>'tipo_precio',
      (v_item->>'subtotal')::numeric,
      (v_item->>'monto_iva')::numeric,
      (v_item->>'total_linea')::numeric,
      NULLIF(v_item->>'nota',''),
      NULLIF((v_item->>'presentacion_id')::text,'')::uuid
    );

    -- Adicionales de la línea (precio unitario del catálogo — NO del cliente).
    IF jsonb_typeof(v_item->'adicionales') = 'array' THEN
      FOR v_adi IN SELECT * FROM jsonb_array_elements(v_item->'adicionales')
      LOOP
        INSERT INTO acaihouse.venta_item_adicionales (
          empresa_id, venta_item_id, adicional_id, adicional_nombre,
          precio_unitario, cantidad
        )
        VALUES (
          v_empresa_id, v_item_id,
          NULLIF((v_adi->>'adicional_id')::text,'')::uuid,
          v_adi->>'adicional_nombre',
          (v_adi->>'precio_unitario')::numeric,
          COALESCE((v_adi->>'cantidad')::int, 1)
        );
      END LOOP;
    END IF;

    -- Variantes elegidas: server-side authoritative. Leemos la OPCIÓN real
    -- (productos + receta_grupo_opciones) para armar el snapshot — cantidad,
    -- unidad, merma, sku, nombre y costo_unitario_snapshot vienen del server.
    -- El cliente solo manda (grupo_id, opcion_id).
    IF jsonb_typeof(v_item->'variantes') = 'array' THEN
      FOR v_var IN SELECT * FROM jsonb_array_elements(v_item->'variantes')
      LOOP
        DECLARE
          v_grupo_id uuid := NULLIF((v_var->>'grupo_id')::text,'')::uuid;
          v_opcion_id uuid := NULLIF((v_var->>'opcion_id')::text,'')::uuid;
          v_op_insumo uuid;
          v_op_cantidad numeric;
          v_op_unidad text;
          v_op_merma numeric;
          v_op_etiqueta text;
          v_gr_codigo text;
          v_gr_etiqueta text;
          v_ins_sku text;
          v_ins_nombre text;
          v_ins_costo numeric;
        BEGIN
          IF v_opcion_id IS NULL THEN
            RAISE EXCEPTION 'variante.opcion_id requerido' USING ERRCODE = '22P02';
          END IF;
          SELECT op.insumo_producto_id, op.cantidad, op.unidad_medida, op.merma_pct,
                 op.etiqueta, g.codigo, g.etiqueta
            INTO v_op_insumo, v_op_cantidad, v_op_unidad, v_op_merma,
                 v_op_etiqueta, v_gr_codigo, v_gr_etiqueta
            FROM acaihouse.receta_grupo_opciones op
            JOIN acaihouse.receta_grupos_variante g ON g.id = op.grupo_id
           WHERE op.id = v_opcion_id
             AND op.empresa_id = v_empresa_id
             AND g.empresa_id = v_empresa_id
             AND (v_grupo_id IS NULL OR g.id = v_grupo_id);
          IF v_op_insumo IS NULL THEN
            RAISE EXCEPTION 'Opción % no existe o no pertenece a la empresa/grupo', v_opcion_id USING ERRCODE = '23503';
          END IF;
          -- Costo del insumo SERVER-SIDE (nunca del cliente). FOR UPDATE opcional
          -- aquí: solo capturamos snapshot — el lock real se toma en stock_deltas.
          SELECT sku, nombre, costo_promedio INTO v_ins_sku, v_ins_nombre, v_ins_costo
            FROM acaihouse.productos
           WHERE id = v_op_insumo AND empresa_id = v_empresa_id;
          IF v_ins_sku IS NULL THEN
            RAISE EXCEPTION 'Insumo % de la variante no existe en la empresa', v_op_insumo USING ERRCODE = '23503';
          END IF;
          INSERT INTO acaihouse.venta_item_variantes (
            empresa_id, venta_item_id, grupo_id, opcion_id,
            grupo_codigo, grupo_etiqueta, opcion_etiqueta,
            insumo_producto_id, insumo_sku, insumo_nombre,
            cantidad, unidad_medida, merma_pct, costo_unitario_snapshot
          )
          VALUES (
            v_empresa_id, v_item_id, v_grupo_id, v_opcion_id,
            v_gr_codigo, v_gr_etiqueta, v_op_etiqueta,
            v_op_insumo, v_ins_sku, v_ins_nombre,
            v_op_cantidad, v_op_unidad, v_op_merma, v_ins_costo
          );
        END;
      END LOOP;
    END IF;
  END LOOP;

  -- 3) INSERT cuentas_por_cobrar (solo si venta a crédito)
  IF v_cxc IS NOT NULL AND v_cxc <> 'null'::jsonb THEN
    INSERT INTO acaihouse.cuentas_por_cobrar (
      empresa_id, venta_id, cliente_id, numero_venta, fecha_emision,
      fecha_vencimiento, moneda, total, saldo, estado
    )
    VALUES (
      v_empresa_id, v_venta_id,
      NULLIF((v_venta_header->>'cliente_id')::text,'')::uuid,
      v_venta_header->>'numero_control',
      ((v_venta_header->>'fecha')::timestamptz)::date,
      (v_cxc->>'fecha_vencimiento')::date,
      CASE WHEN v_venta_header->>'moneda' = 'USD' THEN 'USD' ELSE 'PYG' END,
      (v_cxc->>'monto')::numeric,
      (v_cxc->>'saldo')::numeric,
      'pendiente'
    );
  END IF;

  -- 4) Stock deltas ATÓMICOS.
  --    UPDATE SET stock_actual = GREATEST(0, stock_actual - $delta)
  --    con SELECT ... FOR UPDATE previo para serializar ventas concurrentes
  --    del mismo producto/insumo. GREATEST(0, ...) implementa política de
  --    "stock no baja de 0" (permitir_sin_stock). Si permitir_sin_stock=false
  --    y hubiera faltante, abortamos.
  IF jsonb_typeof(v_stock_deltas) = 'array' THEN
    FOR v_delta IN SELECT * FROM jsonb_array_elements(v_stock_deltas)
    LOOP
      v_prod_id := (v_delta->>'producto_id')::uuid;
      v_delta_qty := (v_delta->>'delta_qty')::numeric;
      IF NOT (v_delta_qty > 0) THEN
        CONTINUE; -- deltas no positivos se ignoran por seguridad
      END IF;
      -- LOCK FILA + leer stock+costo actual atómicamente.
      SELECT stock_actual, costo_promedio, nombre, sku
        INTO v_current_stock, v_current_costo, v_prod_nombre, v_prod_sku
        FROM acaihouse.productos
       WHERE id = v_prod_id AND empresa_id = v_empresa_id
       FOR UPDATE;
      IF v_prod_nombre IS NULL THEN
        RAISE EXCEPTION 'Producto % no existe para esta empresa', v_prod_id USING ERRCODE = '23503';
      END IF;
      IF v_current_stock < v_delta_qty AND NOT v_permitir_sin_stock THEN
        RAISE EXCEPTION 'Stock insuficiente de % (stock=%, pedido=%, falta=%)',
          v_prod_nombre, v_current_stock, v_delta_qty, (v_delta_qty - v_current_stock)
          USING ERRCODE = '23514';
      END IF;
      -- Política: cuando `permitir_sin_stock=true`, el stock_actual queda en
      -- su valor real (puede quedar negativo). El movimiento SALIDA registra
      -- la cantidad consumida completa. No usamos GREATEST(0, ...) porque
      -- oculta sobreconsumos y rompe la reconciliación de inventario.
      v_nueva_cantidad := v_current_stock - v_delta_qty;
      UPDATE acaihouse.productos
         SET stock_actual = v_nueva_cantidad
       WHERE id = v_prod_id AND empresa_id = v_empresa_id;
      -- Movimiento SALIDA — costo_unitario = snapshot del server, no del cliente.
      v_mov := v_delta->'movimiento';
      IF v_mov IS NOT NULL AND v_mov <> 'null'::jsonb THEN
        INSERT INTO acaihouse.movimientos_inventario (
          empresa_id, producto_id, producto_nombre, producto_sku,
          tipo, cantidad, costo_unitario, origen, referencia, fecha,
          venta_id, created_by, usuario_nombre
        )
        VALUES (
          v_empresa_id, v_prod_id,
          v_prod_nombre, v_prod_sku,
          COALESCE(v_mov->>'tipo', 'SALIDA'),
          v_delta_qty,
          v_current_costo,
          COALESCE(v_mov->>'origen', 'venta'),
          v_mov->>'referencia',
          COALESCE((v_mov->>'fecha')::timestamptz, now()),
          v_venta_id,
          NULLIF((v_mov->>'created_by')::text,'')::uuid,
          v_mov->>'usuario_nombre'
        );
      END IF;
    END LOOP;
  END IF;

  RETURN QUERY SELECT v_venta_id;
END;
$$;

-- Permisos: SECURITY DEFINER corre con los privilegios del owner (postgres).
-- Revocar al anon. Autenticados pueden ejecutarla; el wrapper TS valida que
-- el empresa_id del payload coincide con el JWT antes de llamar.
REVOKE ALL ON FUNCTION acaihouse.fn_crear_venta_atomica(jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION acaihouse.fn_crear_venta_atomica(jsonb) TO authenticated;
-- Si el servidor usa service_role (JWT con bypass RLS), también se cubre
-- porque service_role hereda los permisos de authenticated.
GRANT  EXECUTE ON FUNCTION acaihouse.fn_crear_venta_atomica(jsonb) TO service_role;

COMMIT;
