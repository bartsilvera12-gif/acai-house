-- =============================================================================
-- Açaí House — Fase 1 (persistencia): presentación y adicionales por línea de venta.
-- Instancia dedicada monocliente. Aplica SOLO al schema `acaihouse`.
-- Idempotente. Aditivo. NO toca otros schemas ni datos existentes.
--
-- Qué agrega
-- ----------
--   • `acaihouse.ventas_items.presentacion_id` (nullable FK → producto_presentaciones)
--     NO se habilita descuento automático de inventario todavía; es solo captura.
--   • `acaihouse.venta_item_adicionales` — tabla hija con 1 fila por adicional elegido
--     en una línea de venta. Guarda snapshot inmutable (nombre + precio al momento
--     de la venta) para que cambios futuros al catálogo no alteren la venta histórica.
--
-- Por qué así
-- -----------
--   • La Fase 2 necesita identificar exactamente qué receta ejecutar: presentacion_id
--     permite asociar una receta distinta por tamaño.
--   • Los adicionales en tabla hija (vs. columna JSON) permiten JOIN con recetas de
--     cada adicional en Fase 2 y reportería por adicional sin parsear JSON.
-- =============================================================================

-- Guarda defensiva: falla rápido si las dependencias base no están.
-- Verificamos además que `acaihouse.ventas_items` tenga PRIMARY KEY (necesaria
-- para FK ON DELETE CASCADE desde venta_item_adicionales).
DO $$
DECLARE
  v_ventas_items_pk_count int;
BEGIN
  IF to_regnamespace('acaihouse')                           IS NULL THEN RAISE EXCEPTION 'Schema acaihouse no existe. Abortando.'; END IF;
  IF to_regclass('acaihouse.ventas_items')                  IS NULL THEN RAISE EXCEPTION 'acaihouse.ventas_items no existe. Abortando.'; END IF;
  IF to_regclass('acaihouse.producto_presentaciones')       IS NULL THEN RAISE EXCEPTION 'acaihouse.producto_presentaciones no existe. Corré la migración previa primero.'; END IF;
  IF to_regclass('acaihouse.adicionales')                   IS NULL THEN RAISE EXCEPTION 'acaihouse.adicionales no existe. Corré la migración previa primero.'; END IF;

  SELECT count(*) INTO v_ventas_items_pk_count
  FROM pg_constraint
  WHERE conrelid = 'acaihouse.ventas_items'::regclass
    AND contype  = 'p';
  IF v_ventas_items_pk_count = 0 THEN
    RAISE EXCEPTION 'acaihouse.ventas_items no tiene PRIMARY KEY; no es posible crear FK ON DELETE CASCADE.';
  END IF;
END$$;

-- 1) Columna presentacion_id en ventas_items ---------------------------------
ALTER TABLE acaihouse.ventas_items
  ADD COLUMN IF NOT EXISTS presentacion_id uuid;

-- Añadir FK sólo si aún no existe (idempotente).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'acaihouse.ventas_items'::regclass
      AND conname  = 'ventas_items_presentacion_fk'
  ) THEN
    ALTER TABLE acaihouse.ventas_items
      ADD CONSTRAINT ventas_items_presentacion_fk
      FOREIGN KEY (presentacion_id)
      REFERENCES acaihouse.producto_presentaciones(id)
      ON DELETE SET NULL;  -- la venta histórica no se rompe si se borra el tamaño.
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_ventas_items_presentacion
  ON acaihouse.ventas_items (presentacion_id)
  WHERE presentacion_id IS NOT NULL;

COMMENT ON COLUMN acaihouse.ventas_items.presentacion_id IS
  'Tamaño/presentación elegido en caja. Null = producto sin presentaciones. En Fase 2 determina qué receta descontar.';

-- 2) Tabla venta_item_adicionales -------------------------------------------
CREATE TABLE IF NOT EXISTS acaihouse.venta_item_adicionales (
  id                uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  empresa_id        uuid NOT NULL REFERENCES acaihouse.empresas(id) ON DELETE CASCADE,
  venta_item_id     uuid NOT NULL REFERENCES acaihouse.ventas_items(id) ON DELETE CASCADE,
  adicional_id      uuid REFERENCES acaihouse.adicionales(id) ON DELETE SET NULL,
  -- Snapshot al momento de la venta (inmutable):
  adicional_nombre  text NOT NULL,
  precio_unitario   numeric(14,2) NOT NULL CHECK (precio_unitario >= 0),
  cantidad          int NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vi_adic_venta_item ON acaihouse.venta_item_adicionales (venta_item_id);
CREATE INDEX IF NOT EXISTS idx_vi_adic_adicional  ON acaihouse.venta_item_adicionales (adicional_id);
CREATE INDEX IF NOT EXISTS idx_vi_adic_empresa    ON acaihouse.venta_item_adicionales (empresa_id);

COMMENT ON TABLE acaihouse.venta_item_adicionales IS
  'Adicionales aplicados a una línea de venta. Snapshot (nombre + precio) + adicional_id para JOIN con receta en Fase 2.';

-- 3) RLS + policies estándar ERP --------------------------------------------
-- Patrón: tenant-scoped (empresa_id) → ENABLE RLS + 4 policies con
-- acaihouse.puede_acceder_empresa(empresa_id). service_role bypassea (Supabase).
-- anon SIN DML.
ALTER TABLE acaihouse.venta_item_adicionales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS venta_item_adicionales_select ON acaihouse.venta_item_adicionales;
CREATE POLICY venta_item_adicionales_select ON acaihouse.venta_item_adicionales
  FOR SELECT USING (acaihouse.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS venta_item_adicionales_insert ON acaihouse.venta_item_adicionales;
CREATE POLICY venta_item_adicionales_insert ON acaihouse.venta_item_adicionales
  FOR INSERT WITH CHECK (acaihouse.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS venta_item_adicionales_update ON acaihouse.venta_item_adicionales;
CREATE POLICY venta_item_adicionales_update ON acaihouse.venta_item_adicionales
  FOR UPDATE USING (acaihouse.puede_acceder_empresa(empresa_id))
            WITH CHECK (acaihouse.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS venta_item_adicionales_delete ON acaihouse.venta_item_adicionales;
CREATE POLICY venta_item_adicionales_delete ON acaihouse.venta_item_adicionales
  FOR DELETE USING (acaihouse.puede_acceder_empresa(empresa_id));

-- 4) GRANTs de mínimo privilegio --------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON acaihouse.venta_item_adicionales TO authenticated;
GRANT ALL                             ON acaihouse.venta_item_adicionales TO service_role;
