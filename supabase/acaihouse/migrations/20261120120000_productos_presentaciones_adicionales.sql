-- =============================================================================
-- Açaí House — Fase 1: Presentaciones por tamaño + Adicionales (catálogo).
-- Instancia dedicada monocliente. Aplica SOLO al schema `acaihouse`.
-- Idempotente. Aditivo. NO toca otros schemas ni datos existentes.
--
-- Objeto                                 | Propósito
-- ---------------------------------------+------------------------------------
-- acaihouse.producto_presentaciones      | tamaños (Chico/Mediano/Grande) con precio propio por producto
-- acaihouse.adicionales                  | catálogo de adicionales vendibles (Leche en polvo, Granola, etc.)
-- acaihouse.producto_adicionales_permitidos (opcional) | qué adicionales aplican a qué producto; vacío = todos permitidos
--
-- Seeds:
--   • Categorías iniciales (CARTA / AÇAÍ, MATERIAS PRIMAS, BEBIDAS) por empresa.
--   • 5 adicionales base con precio según carta.
-- =============================================================================

-- Guarda defensiva: falla rápido si el schema base no está. Esta migración NO
-- crea las tablas raíz (`acaihouse.empresas`, `acaihouse.productos`,
-- `acaihouse.categorias_productos`); se asume que ya existen por el bootstrap
-- del tenant. Si alguna falta, abortamos antes de emitir cualquier DDL para
-- evitar objetos a medias.
DO $$
BEGIN
  IF to_regnamespace('acaihouse') IS NULL THEN
    RAISE EXCEPTION 'Schema acaihouse no existe. Abortando migración.';
  END IF;
  IF to_regclass('acaihouse.empresas')              IS NULL THEN RAISE EXCEPTION 'acaihouse.empresas no existe. Abortando.';              END IF;
  IF to_regclass('acaihouse.productos')             IS NULL THEN RAISE EXCEPTION 'acaihouse.productos no existe. Abortando.';             END IF;
  IF to_regclass('acaihouse.categorias_productos')  IS NULL THEN RAISE EXCEPTION 'acaihouse.categorias_productos no existe. Abortando.';  END IF;
END$$;

-- 1) producto_presentaciones -------------------------------------------------
CREATE TABLE IF NOT EXISTS acaihouse.producto_presentaciones (
  id           uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  empresa_id   uuid NOT NULL REFERENCES acaihouse.empresas(id) ON DELETE CASCADE,
  producto_id  uuid NOT NULL REFERENCES acaihouse.productos(id) ON DELETE CASCADE,
  nombre       text NOT NULL,                            -- ej. "Chico", "Mediano", "Grande"
  precio       numeric(14,2) NOT NULL CHECK (precio >= 0),
  orden        int NOT NULL DEFAULT 0,
  activo       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_presentaciones_producto ON acaihouse.producto_presentaciones (producto_id);
CREATE INDEX IF NOT EXISTS idx_presentaciones_empresa  ON acaihouse.producto_presentaciones (empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_presentaciones_producto_nombre
  ON acaihouse.producto_presentaciones (producto_id, lower(trim(nombre)));

COMMENT ON TABLE acaihouse.producto_presentaciones IS
  'Presentaciones (tamaños) por producto con precio propio. Cada una puede asociar su propia receta en fases posteriores.';
COMMENT ON COLUMN acaihouse.producto_presentaciones.nombre IS 'Etiqueta visible: Chico, Mediano, Grande, 500ml, etc.';
COMMENT ON COLUMN acaihouse.producto_presentaciones.precio IS 'Precio de venta en Gs. Reemplaza al precio_venta del producto cuando se elige esta presentación.';
COMMENT ON COLUMN acaihouse.producto_presentaciones.orden  IS 'Orden de aparición en caja (menor primero).';

-- 2) adicionales (catálogo) --------------------------------------------------
CREATE TABLE IF NOT EXISTS acaihouse.adicionales (
  id          uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES acaihouse.empresas(id) ON DELETE CASCADE,
  nombre      text NOT NULL,
  precio      numeric(14,2) NOT NULL CHECK (precio >= 0),
  orden       int NOT NULL DEFAULT 0,
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adicionales_empresa ON acaihouse.adicionales (empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_adicionales_empresa_nombre
  ON acaihouse.adicionales (empresa_id, lower(trim(nombre)));

COMMENT ON TABLE acaihouse.adicionales IS
  'Catálogo global de adicionales (toppings) seleccionables al vender. La lógica de descuento de insumos es Fase 2.';

-- 3) producto_adicionales_permitidos (opcional) -----------------------------
-- Si un producto no tiene filas aquí, todos los adicionales activos aplican.
-- Si tiene al menos una, solo se muestran los permitidos.
CREATE TABLE IF NOT EXISTS acaihouse.producto_adicionales_permitidos (
  id            uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES acaihouse.empresas(id) ON DELETE CASCADE,
  producto_id   uuid NOT NULL REFERENCES acaihouse.productos(id) ON DELETE CASCADE,
  adicional_id  uuid NOT NULL REFERENCES acaihouse.adicionales(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_prod_adic UNIQUE (producto_id, adicional_id)
);

CREATE INDEX IF NOT EXISTS idx_prod_adic_producto  ON acaihouse.producto_adicionales_permitidos (producto_id);
CREATE INDEX IF NOT EXISTS idx_prod_adic_adicional ON acaihouse.producto_adicionales_permitidos (adicional_id);

-- 4) Trigger updated_at (reusa patrón enlodemari) ---------------------------
CREATE OR REPLACE FUNCTION acaihouse._touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'tg_presentaciones_touch' AND tgrelid = 'acaihouse.producto_presentaciones'::regclass
  ) THEN
    CREATE TRIGGER tg_presentaciones_touch BEFORE UPDATE ON acaihouse.producto_presentaciones
      FOR EACH ROW EXECUTE FUNCTION acaihouse._touch_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'tg_adicionales_touch' AND tgrelid = 'acaihouse.adicionales'::regclass
  ) THEN
    CREATE TRIGGER tg_adicionales_touch BEFORE UPDATE ON acaihouse.adicionales
      FOR EACH ROW EXECUTE FUNCTION acaihouse._touch_updated_at();
  END IF;
END$$;

-- 5) Seeds por empresa -------------------------------------------------------
-- Categorías: insertar si no existen (match case-insensitive por el UNIQUE lower(trim(nombre))).
INSERT INTO acaihouse.categorias_productos (empresa_id, nombre, codigo, descripcion, activo)
SELECT e.id, v.nombre, v.codigo, v.descripcion, true
FROM acaihouse.empresas e
CROSS JOIN (VALUES
  ('CARTA / AÇAÍ',     'carta_acai',      'Productos preparados de la carta principal.'),
  ('MATERIAS PRIMAS',  'materias_primas', 'Insumos no vendibles al público, usados en recetas.'),
  ('BEBIDAS',          'bebidas',         'Gaseosas, aguas, jugos y otras bebidas.')
) AS v(nombre, codigo, descripcion)
ON CONFLICT DO NOTHING;

-- Adicionales: precios según carta Fase 1 (Leche en polvo 2.000, Leche condensada 2.000,
-- Granola 2.000, Chocolate 4.000, Rocklets 4.000).
INSERT INTO acaihouse.adicionales (empresa_id, nombre, precio, orden, activo)
SELECT e.id, v.nombre, v.precio, v.orden, true
FROM acaihouse.empresas e
CROSS JOIN (VALUES
  ('Leche en polvo',    2000::numeric, 10),
  ('Leche condensada',  2000::numeric, 20),
  ('Granola',           2000::numeric, 30),
  ('Chocolate',         4000::numeric, 40),
  ('Rocklets',          4000::numeric, 50)
) AS v(nombre, precio, orden)
ON CONFLICT DO NOTHING;

-- 6) RLS + policies estándar de la ERP -------------------------------------
-- Patrón (ver 20260619140000_rls_repair_tablas_olvidadas.sql):
--   · Tenant-scoped (empresa_id) → ENABLE RLS + 4 policies con
--     acaihouse.puede_acceder_empresa(empresa_id).
--   · service_role bypassea RLS por diseño Supabase, así que todos los writes
--     del backend (vía /api/...) siguen funcionando con su cliente dedicado.
--   · authenticated puede escribir pero sólo filas donde la policy aprueba.
--   · anon NUNCA recibe grants de DML (sólo USAGE en el schema por bootstrap).

ALTER TABLE acaihouse.producto_presentaciones         ENABLE ROW LEVEL SECURITY;
ALTER TABLE acaihouse.adicionales                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE acaihouse.producto_adicionales_permitidos ENABLE ROW LEVEL SECURITY;

-- producto_presentaciones ----------------------------------------------------
DROP POLICY IF EXISTS producto_presentaciones_select ON acaihouse.producto_presentaciones;
CREATE POLICY producto_presentaciones_select ON acaihouse.producto_presentaciones
  FOR SELECT USING (acaihouse.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS producto_presentaciones_insert ON acaihouse.producto_presentaciones;
CREATE POLICY producto_presentaciones_insert ON acaihouse.producto_presentaciones
  FOR INSERT WITH CHECK (acaihouse.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS producto_presentaciones_update ON acaihouse.producto_presentaciones;
CREATE POLICY producto_presentaciones_update ON acaihouse.producto_presentaciones
  FOR UPDATE USING (acaihouse.puede_acceder_empresa(empresa_id))
            WITH CHECK (acaihouse.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS producto_presentaciones_delete ON acaihouse.producto_presentaciones;
CREATE POLICY producto_presentaciones_delete ON acaihouse.producto_presentaciones
  FOR DELETE USING (acaihouse.puede_acceder_empresa(empresa_id));

-- adicionales ----------------------------------------------------------------
DROP POLICY IF EXISTS adicionales_select ON acaihouse.adicionales;
CREATE POLICY adicionales_select ON acaihouse.adicionales
  FOR SELECT USING (acaihouse.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS adicionales_insert ON acaihouse.adicionales;
CREATE POLICY adicionales_insert ON acaihouse.adicionales
  FOR INSERT WITH CHECK (acaihouse.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS adicionales_update ON acaihouse.adicionales;
CREATE POLICY adicionales_update ON acaihouse.adicionales
  FOR UPDATE USING (acaihouse.puede_acceder_empresa(empresa_id))
            WITH CHECK (acaihouse.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS adicionales_delete ON acaihouse.adicionales;
CREATE POLICY adicionales_delete ON acaihouse.adicionales
  FOR DELETE USING (acaihouse.puede_acceder_empresa(empresa_id));

-- producto_adicionales_permitidos --------------------------------------------
DROP POLICY IF EXISTS producto_adicionales_permitidos_select ON acaihouse.producto_adicionales_permitidos;
CREATE POLICY producto_adicionales_permitidos_select ON acaihouse.producto_adicionales_permitidos
  FOR SELECT USING (acaihouse.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS producto_adicionales_permitidos_insert ON acaihouse.producto_adicionales_permitidos;
CREATE POLICY producto_adicionales_permitidos_insert ON acaihouse.producto_adicionales_permitidos
  FOR INSERT WITH CHECK (acaihouse.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS producto_adicionales_permitidos_update ON acaihouse.producto_adicionales_permitidos;
CREATE POLICY producto_adicionales_permitidos_update ON acaihouse.producto_adicionales_permitidos
  FOR UPDATE USING (acaihouse.puede_acceder_empresa(empresa_id))
            WITH CHECK (acaihouse.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS producto_adicionales_permitidos_delete ON acaihouse.producto_adicionales_permitidos;
CREATE POLICY producto_adicionales_permitidos_delete ON acaihouse.producto_adicionales_permitidos
  FOR DELETE USING (acaihouse.puede_acceder_empresa(empresa_id));

-- 7) GRANTs de mínimo privilegio ---------------------------------------------
-- anon: SIN acceso de DML (siguiendo el patrón zentra/omnicanal del repo).
GRANT SELECT, INSERT, UPDATE, DELETE ON acaihouse.producto_presentaciones         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON acaihouse.adicionales                     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON acaihouse.producto_adicionales_permitidos TO authenticated;
GRANT ALL                             ON acaihouse.producto_presentaciones         TO service_role;
GRANT ALL                             ON acaihouse.adicionales                     TO service_role;
GRANT ALL                             ON acaihouse.producto_adicionales_permitidos TO service_role;
