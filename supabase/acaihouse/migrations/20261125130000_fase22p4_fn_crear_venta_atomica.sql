-- Fase 2.2 Parte 4 — Función transaccional atómica para crear la venta
-- y sus hijos (items, adicionales, variantes, cuentas por cobrar).
--
-- Reemplaza el actual "rollback best-effort" del lado TS por una única
-- llamada RPC. PL/pgSQL corre dentro de una transacción implícita del server:
-- si cualquier INSERT falla, toda la operación hace rollback automático y
-- devuelve el error al caller. Nada queda persistido parcialmente.
--
-- Diseño:
--   - Todas las validaciones NO-triviales (stock, precios máximos, permisos
--     de adicionales, coherencia de presentación) se hacen EN EL EXECUTOR TS
--     antes de la RPC. Esta función asume que los datos vienen ya validados
--     y confía en los triggers del schema para la última línea de defensa.
--   - Recibe payload JSONB con estructura conocida (ver esquema abajo).
--   - Devuelve TABLE(venta_id uuid) para que el caller tenga el id del header.
--   - Movimientos de inventario NO forman parte de esta función; se agregarán
--     cuando se habilite consumo automático (hoy flag OFF para Açaí House).
--   - SECURITY INVOKER: respeta RLS del usuario autenticado. Los INSERTs
--     cumplen las políticas de cada tabla porque empresa_id va explícito.
--
-- Esquema del payload esperado (todos los campos obligatorios salvo los marcados):
--   {
--     "empresa_id": uuid,
--     "venta": { número_control, fecha, total, subtotal, monto_iva, tipo_iva_resumen,
--                tipo_venta ("CONTADO"|"CREDITO"), plazo_dias, fecha_vencimiento?,
--                moneda, tipo_cambio, cliente_id?, observaciones?, metodo_pago,
--                caja_id?, created_by?, usuario_nombre?, genera_nota_remision,
--                pedido_cocina?: { modalidad, mesa, cliente_nombre, cliente_telefono,
--                                  direccion_entrega, observacion } },
--     "items":  [{ id (uuid pre-generado), producto_id, producto_nombre, sku, cantidad,
--                  precio_venta_original, precio_venta, tipo_iva, tipo_precio,
--                  subtotal, monto_iva, total_linea, nota?, presentacion_id?,
--                  adicionales?: [{ adicional_id?, adicional_nombre, precio_unitario, cantidad }],
--                  variantes?:   [{ grupo_id, opcion_id, grupo_codigo, grupo_etiqueta,
--                                   opcion_etiqueta, insumo_producto_id, insumo_sku,
--                                   insumo_nombre, cantidad, unidad_medida, merma_pct }]
--                }],
--     "cxc": null | { numero_cuota, monto, saldo, fecha_vencimiento }
--   }

BEGIN;

CREATE OR REPLACE FUNCTION acaihouse.fn_crear_venta_atomica(p_payload jsonb)
RETURNS TABLE(venta_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_empresa_id uuid;
  v_venta_header jsonb;
  v_item jsonb;
  v_adi jsonb;
  v_var jsonb;
  v_items jsonb;
  v_venta_id uuid;
  v_item_id uuid;
  v_cxc jsonb;
BEGIN
  v_empresa_id   := (p_payload->>'empresa_id')::uuid;
  v_venta_header := p_payload->'venta';
  v_items        := p_payload->'items';
  v_cxc          := p_payload->'cxc';

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'empresa_id requerido' USING ERRCODE = '22P02';
  END IF;
  IF v_venta_header IS NULL THEN
    RAISE EXCEPTION 'venta requerida' USING ERRCODE = '22P02';
  END IF;
  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items debe ser array no vacío' USING ERRCODE = '22P02';
  END IF;

  -- 1) INSERT ventas (header). Columnas reales de acaihouse.ventas:
  --   numero_control, fecha, total, subtotal, monto_iva, estado, tipo_venta,
  --   plazo_dias, fecha_vencimiento, moneda, tipo_cambio, cliente_id,
  --   observaciones, metodo_pago, caja_id, genera_nota_remision, nota_remision_numero.
  INSERT INTO acaihouse.ventas (
    empresa_id, numero_control, fecha, total, subtotal, monto_iva, estado,
    tipo_venta, plazo_dias, moneda, tipo_cambio,
    cliente_id, observaciones, metodo_pago, caja_id,
    genera_nota_remision
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
    COALESCE((v_venta_header->>'genera_nota_remision')::boolean, false)
  )
  RETURNING id INTO v_venta_id;

  -- 2) INSERT ventas_items (bulk desde el array con id pre-generado)
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

    -- 2.a) adicionales de esta línea
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

    -- 2.b) variantes elegidas de esta línea (snapshot inmutable)
    IF jsonb_typeof(v_item->'variantes') = 'array' THEN
      FOR v_var IN SELECT * FROM jsonb_array_elements(v_item->'variantes')
      LOOP
        INSERT INTO acaihouse.venta_item_variantes (
          empresa_id, venta_item_id, grupo_id, opcion_id,
          grupo_codigo, grupo_etiqueta, opcion_etiqueta,
          insumo_producto_id, insumo_sku, insumo_nombre,
          cantidad, unidad_medida, merma_pct, costo_unitario_snapshot
        )
        VALUES (
          v_empresa_id, v_item_id,
          NULLIF((v_var->>'grupo_id')::text,'')::uuid,
          NULLIF((v_var->>'opcion_id')::text,'')::uuid,
          v_var->>'grupo_codigo',
          v_var->>'grupo_etiqueta',
          v_var->>'opcion_etiqueta',
          (v_var->>'insumo_producto_id')::uuid,
          v_var->>'insumo_sku',
          v_var->>'insumo_nombre',
          (v_var->>'cantidad')::numeric,
          v_var->>'unidad_medida',
          COALESCE((v_var->>'merma_pct')::numeric, 0),
          NULLIF((v_var->>'costo_unitario_snapshot')::text,'')::numeric
        );
      END LOOP;
    END IF;
  END LOOP;

  -- 3) INSERT cuentas_por_cobrar (solo si venta a crédito)
  IF v_cxc IS NOT NULL AND v_cxc <> 'null'::jsonb THEN
    INSERT INTO acaihouse.cuentas_por_cobrar (
      empresa_id, venta_id, cliente_id, numero_cuota, monto, saldo, fecha_vencimiento
    )
    VALUES (
      v_empresa_id, v_venta_id,
      NULLIF((v_venta_header->>'cliente_id')::text,'')::uuid,
      COALESCE((v_cxc->>'numero_cuota')::int, 1),
      (v_cxc->>'monto')::numeric,
      (v_cxc->>'saldo')::numeric,
      (v_cxc->>'fecha_vencimiento')::date
    );
  END IF;

  -- 4) UPDATE productos.stock_actual + INSERT movimientos_inventario (SALIDA).
  --    Procesa stock_updates (productos controla_stock=true y, cuando el flag
  --    de consumo está activo, insumos consumidos por receta/adicional/variante).
  --    Si falla cualquier UPDATE/INSERT, toda la operación hace rollback.
  DECLARE
    v_stock_updates jsonb := p_payload->'stock_updates';
    v_upd jsonb;
    v_prod_id uuid;
    v_nuevo_stock numeric;
    v_mov jsonb;
  BEGIN
    IF jsonb_typeof(v_stock_updates) = 'array' THEN
      FOR v_upd IN SELECT * FROM jsonb_array_elements(v_stock_updates)
      LOOP
        v_prod_id := (v_upd->>'producto_id')::uuid;
        v_nuevo_stock := (v_upd->>'nuevo_stock')::numeric;
        UPDATE acaihouse.productos
           SET stock_actual = v_nuevo_stock
         WHERE id = v_prod_id AND empresa_id = v_empresa_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Producto % no existe para esta empresa', v_prod_id USING ERRCODE = '23503';
        END IF;
        v_mov := v_upd->'movimiento';
        IF v_mov IS NOT NULL AND v_mov <> 'null'::jsonb THEN
          INSERT INTO acaihouse.movimientos_inventario (
            empresa_id, producto_id, producto_nombre, producto_sku,
            tipo, cantidad, costo_unitario, origen, referencia, fecha,
            venta_id, created_by, usuario_nombre
          )
          VALUES (
            v_empresa_id, v_prod_id,
            v_mov->>'producto_nombre', v_mov->>'producto_sku',
            v_mov->>'tipo',
            (v_mov->>'cantidad')::numeric,
            NULLIF((v_mov->>'costo_unitario')::text,'')::numeric,
            v_mov->>'origen',
            v_mov->>'referencia',
            COALESCE((v_mov->>'fecha')::timestamptz, now()),
            v_venta_id,
            NULLIF((v_mov->>'created_by')::text,'')::uuid,
            v_mov->>'usuario_nombre'
          );
        END IF;
      END LOOP;
    END IF;
  END;

  -- Devolver el id del header. Si cualquier INSERT/UPDATE anterior violó
  -- constraint, este RETURN nunca se alcanza: PostgreSQL ya hizo rollback.
  RETURN QUERY SELECT v_venta_id;
END;
$$;

REVOKE ALL ON FUNCTION acaihouse.fn_crear_venta_atomica(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION acaihouse.fn_crear_venta_atomica(jsonb) TO authenticated;

COMMIT;
