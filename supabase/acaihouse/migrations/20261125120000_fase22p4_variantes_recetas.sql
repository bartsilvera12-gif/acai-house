-- Fase 2.2 Parte 4 — Variantes obligatorias dentro de recetas.
-- Migración 100% aditiva. No toca datos existentes.
--
-- Entregables:
--   acaihouse.receta_grupos_variante  (nueva)
--   acaihouse.receta_grupo_opciones   (nueva, trigger de empresa+producto coherente)
--   acaihouse.venta_item_variantes    (nueva, snapshot inmutable)
--   acaihouse.productos              (3 INSERT nuevos: MP-0019/20/21, idempotente)
--
-- Reglas que preserva:
--   - No altera recetas / receta_items / ventas / ventas_items / adicionales existentes.
--   - MP-0004 "Crema de chocolate" queda intacto (historial preservado).
--   - RLS multi-tenant vía acaihouse.puede_acceder_empresa(empresa_id).
--   - FK ON DELETE SET NULL de grupo/opcion en venta_item_variantes: si el admin borra
--     grupo/opción tras la venta, la venta sigue mostrando qué eligió el cliente por snapshot.
--   - Trigger valida que grupo + insumo pertenezcan a la misma empresa.
--   - Trigger valida que la opción use un insumo activo y es_insumo=true.

BEGIN;

-- ============ 1) receta_grupos_variante ============
CREATE TABLE IF NOT EXISTS acaihouse.receta_grupos_variante (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid        NOT NULL,
  receta_id    uuid        NOT NULL REFERENCES acaihouse.recetas(id) ON DELETE CASCADE,
  codigo       text        NOT NULL,
  etiqueta     text        NOT NULL,
  obligatorio  boolean     NOT NULL DEFAULT true,
  orden        int         NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rgv_codigo_fmt     CHECK (codigo ~ '^[a-z][a-z0-9_]{0,31}$'),
  CONSTRAINT rgv_etiqueta_len   CHECK (char_length(etiqueta) BETWEEN 1 AND 60),
  CONSTRAINT rgv_codigo_uq      UNIQUE (empresa_id, receta_id, codigo)
);
CREATE INDEX IF NOT EXISTS rgv_by_receta_idx ON acaihouse.receta_grupos_variante(empresa_id, receta_id, orden);

-- Trigger: empresa de la receta debe coincidir con empresa del grupo.
CREATE OR REPLACE FUNCTION acaihouse.fn_rgv_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_receta_empresa uuid;
BEGIN
  SELECT empresa_id INTO v_receta_empresa FROM acaihouse.recetas WHERE id = NEW.receta_id;
  IF v_receta_empresa IS NULL THEN
    RAISE EXCEPTION 'Receta % no existe', NEW.receta_id USING ERRCODE = '23503';
  END IF;
  IF v_receta_empresa <> NEW.empresa_id THEN
    RAISE EXCEPTION 'Receta pertenece a otra empresa (%)', v_receta_empresa USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_rgv_check ON acaihouse.receta_grupos_variante;
CREATE TRIGGER tg_rgv_check
  BEFORE INSERT OR UPDATE OF empresa_id, receta_id
  ON acaihouse.receta_grupos_variante
  FOR EACH ROW EXECUTE FUNCTION acaihouse.fn_rgv_check();

-- ============ 2) receta_grupo_opciones ============
CREATE TABLE IF NOT EXISTS acaihouse.receta_grupo_opciones (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid        NOT NULL,
  grupo_id           uuid        NOT NULL REFERENCES acaihouse.receta_grupos_variante(id) ON DELETE CASCADE,
  insumo_producto_id uuid        NOT NULL REFERENCES acaihouse.productos(id) ON DELETE RESTRICT,
  cantidad           numeric     NOT NULL,
  unidad_medida      text        NOT NULL,
  merma_pct          numeric     NOT NULL DEFAULT 0,
  etiqueta           text        NOT NULL,
  orden              int         NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rgo_cantidad_pos     CHECK (cantidad > 0),
  CONSTRAINT rgo_merma_range      CHECK (merma_pct >= 0 AND merma_pct < 1),
  CONSTRAINT rgo_etiqueta_len     CHECK (char_length(etiqueta) BETWEEN 1 AND 60),
  CONSTRAINT rgo_insumo_uq        UNIQUE (grupo_id, insumo_producto_id)
);
CREATE INDEX IF NOT EXISTS rgo_by_grupo_idx ON acaihouse.receta_grupo_opciones(empresa_id, grupo_id, orden);

-- Trigger: grupo + insumo deben pertenecer a la misma empresa, insumo debe ser es_insumo=true y activo.
CREATE OR REPLACE FUNCTION acaihouse.fn_rgo_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_grupo_empresa uuid;
  v_ins_empresa   uuid;
  v_ins_is_insumo boolean;
  v_ins_activo    boolean;
BEGIN
  SELECT empresa_id INTO v_grupo_empresa FROM acaihouse.receta_grupos_variante WHERE id = NEW.grupo_id;
  IF v_grupo_empresa IS NULL THEN
    RAISE EXCEPTION 'Grupo % no existe', NEW.grupo_id USING ERRCODE = '23503';
  END IF;
  IF v_grupo_empresa <> NEW.empresa_id THEN
    RAISE EXCEPTION 'Grupo pertenece a otra empresa' USING ERRCODE = '23514';
  END IF;
  SELECT empresa_id, es_insumo, activo INTO v_ins_empresa, v_ins_is_insumo, v_ins_activo
    FROM acaihouse.productos WHERE id = NEW.insumo_producto_id;
  IF v_ins_empresa IS NULL THEN
    RAISE EXCEPTION 'Insumo % no existe', NEW.insumo_producto_id USING ERRCODE = '23503';
  END IF;
  IF v_ins_empresa <> NEW.empresa_id THEN
    RAISE EXCEPTION 'Insumo no pertenece a la empresa' USING ERRCODE = '23514';
  END IF;
  IF NOT v_ins_is_insumo THEN
    RAISE EXCEPTION 'Producto % no es insumo (es_insumo=false)', NEW.insumo_producto_id USING ERRCODE = '23514';
  END IF;
  IF NOT v_ins_activo THEN
    RAISE EXCEPTION 'Insumo % está inactivo', NEW.insumo_producto_id USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_rgo_check ON acaihouse.receta_grupo_opciones;
CREATE TRIGGER tg_rgo_check
  BEFORE INSERT OR UPDATE OF grupo_id, insumo_producto_id, empresa_id
  ON acaihouse.receta_grupo_opciones
  FOR EACH ROW EXECUTE FUNCTION acaihouse.fn_rgo_check();

-- ============ 3) venta_item_variantes (snapshot inmutable) ============
CREATE TABLE IF NOT EXISTS acaihouse.venta_item_variantes (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id              uuid        NOT NULL,
  venta_item_id           uuid        NOT NULL REFERENCES acaihouse.ventas_items(id) ON DELETE CASCADE,
  grupo_id                uuid        NULL REFERENCES acaihouse.receta_grupos_variante(id) ON DELETE SET NULL,
  opcion_id               uuid        NULL REFERENCES acaihouse.receta_grupo_opciones(id) ON DELETE SET NULL,
  grupo_codigo            text        NOT NULL,
  grupo_etiqueta          text        NOT NULL,
  opcion_etiqueta         text        NOT NULL,
  insumo_producto_id      uuid        NOT NULL REFERENCES acaihouse.productos(id) ON DELETE RESTRICT,
  insumo_sku              text        NOT NULL,
  insumo_nombre           text        NOT NULL,
  cantidad                numeric     NOT NULL,
  unidad_medida           text        NOT NULL,
  merma_pct               numeric     NOT NULL DEFAULT 0,
  -- Costo histórico por unidad de insumo al momento de la venta. Snapshot
  -- inmutable: cambios posteriores de productos.costo_promedio no afectan.
  -- Permite reconstruir el costo total de la venta aun con consumo auto OFF
  -- (cuando no hay movimientos_inventario que capturen costo_unitario).
  costo_unitario_snapshot numeric     NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT viv_una_por_grupo UNIQUE (venta_item_id, grupo_codigo),
  CONSTRAINT viv_cantidad_pos  CHECK (cantidad > 0),
  CONSTRAINT viv_costo_nonneg  CHECK (costo_unitario_snapshot IS NULL OR costo_unitario_snapshot >= 0)
);
CREATE INDEX IF NOT EXISTS viv_by_venta_item_idx ON acaihouse.venta_item_variantes(empresa_id, venta_item_id);
CREATE INDEX IF NOT EXISTS viv_by_insumo_idx     ON acaihouse.venta_item_variantes(empresa_id, insumo_producto_id);

-- Trigger de consistencia de empresa para el snapshot (defensa adicional: el empresa_id
-- del snapshot debe coincidir con el de la venta_item y, si existe, con el del grupo).
CREATE OR REPLACE FUNCTION acaihouse.fn_viv_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_vi_empresa uuid;
  v_gr_empresa uuid;
  v_op_empresa uuid;
  v_ins_empresa uuid;
BEGIN
  SELECT empresa_id INTO v_vi_empresa FROM acaihouse.ventas_items WHERE id = NEW.venta_item_id;
  IF v_vi_empresa IS NULL THEN
    RAISE EXCEPTION 'venta_item % no existe', NEW.venta_item_id USING ERRCODE = '23503';
  END IF;
  IF v_vi_empresa <> NEW.empresa_id THEN
    RAISE EXCEPTION 'venta_item pertenece a otra empresa' USING ERRCODE = '23514';
  END IF;
  IF NEW.grupo_id IS NOT NULL THEN
    SELECT empresa_id INTO v_gr_empresa FROM acaihouse.receta_grupos_variante WHERE id = NEW.grupo_id;
    IF v_gr_empresa IS NOT NULL AND v_gr_empresa <> NEW.empresa_id THEN
      RAISE EXCEPTION 'grupo pertenece a otra empresa' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.opcion_id IS NOT NULL THEN
    SELECT empresa_id INTO v_op_empresa FROM acaihouse.receta_grupo_opciones WHERE id = NEW.opcion_id;
    IF v_op_empresa IS NOT NULL AND v_op_empresa <> NEW.empresa_id THEN
      RAISE EXCEPTION 'opcion pertenece a otra empresa' USING ERRCODE = '23514';
    END IF;
  END IF;
  SELECT empresa_id INTO v_ins_empresa FROM acaihouse.productos WHERE id = NEW.insumo_producto_id;
  IF v_ins_empresa IS NULL OR v_ins_empresa <> NEW.empresa_id THEN
    RAISE EXCEPTION 'insumo pertenece a otra empresa' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_viv_check ON acaihouse.venta_item_variantes;
CREATE TRIGGER tg_viv_check
  BEFORE INSERT OR UPDATE OF venta_item_id, grupo_id, opcion_id, insumo_producto_id, empresa_id
  ON acaihouse.venta_item_variantes
  FOR EACH ROW EXECUTE FUNCTION acaihouse.fn_viv_check();

-- ============ 4) RLS multi-tenant ============
ALTER TABLE acaihouse.receta_grupos_variante ENABLE ROW LEVEL SECURITY;
ALTER TABLE acaihouse.receta_grupo_opciones  ENABLE ROW LEVEL SECURITY;
ALTER TABLE acaihouse.venta_item_variantes   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rgv_tenant ON acaihouse.receta_grupos_variante;
DROP POLICY IF EXISTS rgo_tenant ON acaihouse.receta_grupo_opciones;
DROP POLICY IF EXISTS viv_tenant ON acaihouse.venta_item_variantes;

CREATE POLICY rgv_tenant ON acaihouse.receta_grupos_variante
  USING (acaihouse.puede_acceder_empresa(empresa_id))
  WITH CHECK (acaihouse.puede_acceder_empresa(empresa_id));
CREATE POLICY rgo_tenant ON acaihouse.receta_grupo_opciones
  USING (acaihouse.puede_acceder_empresa(empresa_id))
  WITH CHECK (acaihouse.puede_acceder_empresa(empresa_id));
CREATE POLICY viv_tenant ON acaihouse.venta_item_variantes
  USING (acaihouse.puede_acceder_empresa(empresa_id))
  WITH CHECK (acaihouse.puede_acceder_empresa(empresa_id));

REVOKE ALL ON acaihouse.receta_grupos_variante FROM anon;
REVOKE ALL ON acaihouse.receta_grupo_opciones  FROM anon;
REVOKE ALL ON acaihouse.venta_item_variantes   FROM anon;
GRANT  SELECT, INSERT, UPDATE, DELETE ON acaihouse.receta_grupos_variante TO authenticated;
GRANT  SELECT, INSERT, UPDATE, DELETE ON acaihouse.receta_grupo_opciones  TO authenticated;
GRANT  SELECT, INSERT, UPDATE, DELETE ON acaihouse.venta_item_variantes   TO authenticated;

-- ============ 5) Insumos variantes (idempotente, no toca MP-0004) ============
-- Crema de chocolate blanco / negro / Cookies. unidad_medida=G, unidad_compra=KG,
-- factor_compra_receta=1000 (idéntico al patrón de los insumos existentes en G).
INSERT INTO acaihouse.productos
  (empresa_id, sku, nombre, unidad_medida, unidad_compra, unidad_receta, factor_compra_receta,
   es_insumo, es_vendible, controla_stock, valorizado, activo, costo_promedio, stock_actual)
VALUES
  ('a9276529-bca9-418a-b014-375e68d667d2','MP-0019','Crema de chocolate blanco',  'G','KG','G',1000, true,false,true,true,true, 0, 0),
  ('a9276529-bca9-418a-b014-375e68d667d2','MP-0020','Crema de chocolate negro',   'G','KG','G',1000, true,false,true,true,true, 0, 0),
  ('a9276529-bca9-418a-b014-375e68d667d2','MP-0021','Crema de chocolate Cookies', 'G','KG','G',1000, true,false,true,true,true, 0, 0)
ON CONFLICT (empresa_id, sku) DO NOTHING;

COMMIT;
