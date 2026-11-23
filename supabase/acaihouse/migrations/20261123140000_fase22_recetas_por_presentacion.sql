-- Fase 2.2 Parte 1 — Recetas por presentación + adicionales con insumo físico.
-- Migración 100% aditiva. No toca datos existentes.
--
-- Cambios:
--   acaihouse.recetas:
--     + presentacion_id uuid NULL REFERENCES producto_presentaciones(id) ON DELETE RESTRICT
--     - DROP CONSTRAINT recetas_empresa_id_producto_id_key (reemplazado por unique parcial)
--     + UNIQUE INDEX recetas_activa_producto_presentacion_uq
--         ON (empresa_id, producto_id, presentacion_id) NULLS NOT DISTINCT WHERE activa=true
--   acaihouse.recetas:
--     + Trigger tg_recetas_presentacion_check que garantiza:
--         a) La presentación referenciada existe.
--         b) producto_presentaciones.producto_id == recetas.producto_id.
--         c) producto_presentaciones.empresa_id == recetas.empresa_id.
--   acaihouse.adicionales:
--     + insumo_producto_id uuid NULL REFERENCES productos(id) ON DELETE SET NULL
--     + insumo_cantidad    numeric NULL CHECK (insumo_cantidad IS NULL OR insumo_cantidad > 0)
--     + insumo_unidad      text    NULL
--
-- Receta histórica preservada: queda activa=true hasta la carga transaccional nueva
-- (archivarla dentro de la misma transacción de carga, no acá).

BEGIN;

-- ============ RECETAS: presentacion_id + validación + unique parcial ============

-- ON DELETE RESTRICT: no permite borrar una presentación si tiene recetas vinculadas.
-- Evita que una receta específica (Chico/Mediano/Grande) se convierta accidentalmente
-- en receta base al eliminar su presentación. El operador debe archivar la receta
-- explícitamente antes de borrar la presentación.
ALTER TABLE acaihouse.recetas
  ADD COLUMN IF NOT EXISTS presentacion_id uuid NULL
    REFERENCES acaihouse.producto_presentaciones(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION acaihouse.fn_receta_presentacion_check()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_pp_producto uuid;
  v_pp_empresa  uuid;
BEGIN
  IF NEW.presentacion_id IS NULL THEN RETURN NEW; END IF;
  SELECT producto_id, empresa_id INTO v_pp_producto, v_pp_empresa
    FROM acaihouse.producto_presentaciones WHERE id = NEW.presentacion_id;
  IF v_pp_producto IS NULL THEN
    RAISE EXCEPTION 'Presentación % no existe', NEW.presentacion_id USING ERRCODE = '23503';
  END IF;
  IF v_pp_producto <> NEW.producto_id THEN
    RAISE EXCEPTION 'La presentación % no pertenece al producto %',
      NEW.presentacion_id, NEW.producto_id USING ERRCODE = '23514';
  END IF;
  IF v_pp_empresa <> NEW.empresa_id THEN
    RAISE EXCEPTION 'La presentación % no pertenece a la empresa %',
      NEW.presentacion_id, NEW.empresa_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_recetas_presentacion_check ON acaihouse.recetas;
CREATE TRIGGER tg_recetas_presentacion_check
  BEFORE INSERT OR UPDATE OF presentacion_id, producto_id, empresa_id
  ON acaihouse.recetas
  FOR EACH ROW EXECUTE FUNCTION acaihouse.fn_receta_presentacion_check();

-- Reemplazar UNIQUE(empresa_id, producto_id) por unique parcial que permite múltiples
-- recetas por producto (una base + una por presentación) siempre que SOLO una esté activa
-- por (empresa, producto, presentación). NULLS NOT DISTINCT (PG 15+) hace que presentacion=NULL
-- también sea única con cualquier otra presentacion=NULL activa.
ALTER TABLE acaihouse.recetas
  DROP CONSTRAINT IF EXISTS recetas_empresa_id_producto_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS recetas_activa_producto_presentacion_uq
  ON acaihouse.recetas (empresa_id, producto_id, presentacion_id)
  NULLS NOT DISTINCT
  WHERE activa = true;

COMMENT ON COLUMN acaihouse.recetas.presentacion_id IS
  'Fase 2.2: receta específica por presentación (tamaño). NULL = receta base del producto.';

-- ============ ADICIONALES: vínculo con insumo físico (alternativa A) ============

ALTER TABLE acaihouse.adicionales
  ADD COLUMN IF NOT EXISTS insumo_producto_id uuid NULL
    REFERENCES acaihouse.productos(id) ON DELETE SET NULL;

ALTER TABLE acaihouse.adicionales
  ADD COLUMN IF NOT EXISTS insumo_cantidad numeric NULL
    CHECK (insumo_cantidad IS NULL OR insumo_cantidad > 0);

ALTER TABLE acaihouse.adicionales
  ADD COLUMN IF NOT EXISTS insumo_unidad text NULL;

COMMENT ON COLUMN acaihouse.adicionales.insumo_producto_id IS
  'Fase 2.2: FK al insumo físico que se descuenta al vender este adicional. NULL = no descuenta stock.';
COMMENT ON COLUMN acaihouse.adicionales.insumo_cantidad IS
  'Fase 2.2: cantidad de insumo consumida por porción adicional. NULL = pendiente de definir, no descuenta.';
COMMENT ON COLUMN acaihouse.adicionales.insumo_unidad IS
  'Fase 2.2: unidad de la cantidad (G / UNIDAD / ML / KG). NULL = usa unidad base del insumo.';

COMMIT;
