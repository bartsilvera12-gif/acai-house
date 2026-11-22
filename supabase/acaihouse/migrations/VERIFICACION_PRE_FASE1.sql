-- =============================================================================
-- Açaí House — Verificación read-only antes de aplicar las migraciones Fase 1.
-- No modifica NADA. Solo SELECT. Ejecutar desde Supabase SQL editor conectado
-- al proyecto de Açaí House.
--
-- Cubre:
--   1. Identidad de la instancia (sin exponer credenciales)
--   2. Existencia del schema `acaihouse` y dependencias base
--   3. Tablas, funciones, FKs, permisos y RLS que necesitan las migraciones
--   4. Idempotencia / colisión potencial con objetos ya existentes
--   5. Volumen de datos operativos (orden de magnitud)
--   6. Pistas sobre respaldo recuperable
-- =============================================================================

\echo ''
\echo '== 1. Identidad de la instancia Postgres =='
SELECT current_database()                        AS database,
       current_user                              AS current_role,
       inet_server_addr()::text                  AS server_ip_o_null_si_local,
       current_setting('server_version')         AS postgres_version,
       current_setting('cluster_name', true)     AS cluster_name;

\echo ''
\echo '== 2. Schema acaihouse y dependencias =='
SELECT
  to_regnamespace('acaihouse')                          IS NOT NULL AS schema_acaihouse,
  to_regclass('acaihouse.empresas')                     IS NOT NULL AS tabla_empresas,
  to_regclass('acaihouse.productos')                    IS NOT NULL AS tabla_productos,
  to_regclass('acaihouse.categorias_productos')         IS NOT NULL AS tabla_categorias_productos,
  to_regclass('acaihouse.ventas')                       IS NOT NULL AS tabla_ventas,
  to_regclass('acaihouse.ventas_items')                 IS NOT NULL AS tabla_ventas_items,
  to_regclass('acaihouse.movimientos_inventario')       IS NOT NULL AS tabla_mov_inv,
  to_regclass('acaihouse.cuentas_por_cobrar')           IS NOT NULL AS tabla_cxc,
  to_regprocedure('acaihouse.puede_acceder_empresa(uuid)') IS NOT NULL AS fn_puede_acceder_empresa;

\echo ''
\echo '== 2b. Extensión gen_random_uuid =='
-- Las migraciones usan `extensions.gen_random_uuid()` (patrón enlodemari).
-- Verificamos qué extensión está instalada y en qué schema para anticipar
-- conflictos si la clave estuviera en otro lado.
SELECT e.extname, n.nspname AS schema_extension
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname IN ('pgcrypto','uuid-ossp');

\echo ''
\echo '== 2c. PRIMARY KEY en acaihouse.ventas_items =='
-- La migración 2 crea una FK ON DELETE CASCADE contra ventas_items(id).
-- Sin PK aborta. Verificamos.
SELECT conname AS pk_constraint
FROM pg_constraint
WHERE conrelid = 'acaihouse.ventas_items'::regclass
  AND contype  = 'p';

\echo ''
\echo '== 3. Objetos que las migraciones van a crear — ¿ya existen? =='
-- Si alguno existe, la migración 1 lo omite (IF NOT EXISTS). Solo informativo.
SELECT
  to_regclass('acaihouse.producto_presentaciones')         IS NOT NULL AS ya_producto_presentaciones,
  to_regclass('acaihouse.adicionales')                     IS NOT NULL AS ya_adicionales,
  to_regclass('acaihouse.producto_adicionales_permitidos') IS NOT NULL AS ya_prod_adic_permitidos,
  to_regclass('acaihouse.venta_item_adicionales')          IS NOT NULL AS ya_vi_adicionales;

\echo ''
\echo '== 3b. ¿Ya existe columna ventas_items.presentacion_id? =='
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'acaihouse'
  AND table_name   = 'ventas_items'
  AND column_name  = 'presentacion_id';

\echo ''
\echo '== 3c. RLS en tablas tenant-scoped existentes =='
-- Verifica que el patrón RLS que usarán las migraciones ya está vigente.
SELECT c.relname, c.relrowsecurity AS rls_enabled,
  (SELECT count(*) FROM pg_policies p
    WHERE p.schemaname='acaihouse' AND p.tablename=c.relname) AS policies_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='acaihouse'
  AND c.relkind='r'
  AND c.relname IN ('productos','categorias_productos','ventas','ventas_items',
                    'movimientos_inventario','cuentas_por_cobrar')
ORDER BY c.relname;

\echo ''
\echo '== 3d. GRANTs vigentes en acaihouse (patrón del tenant) =='
-- Qué tiene authenticated/anon/service_role hoy sobre una tabla representativa.
SELECT grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_schema='acaihouse' AND table_name='productos'
  AND grantee IN ('anon','authenticated','service_role')
ORDER BY grantee, privilege_type;

\echo ''
\echo '== 4. Idempotencia / posibles colisiones =='
-- Nombres de policy, trigger y función que la migración 1 crea. Si existen con
-- la misma firma, el DROP POLICY IF EXISTS / CREATE OR REPLACE FUNCTION no rompen.
SELECT 'policy'         AS obj, p.polname AS nombre, p.polrelid::regclass::text AS parent
FROM pg_policy p
WHERE p.polname IN (
  'producto_presentaciones_select','producto_presentaciones_insert',
  'producto_presentaciones_update','producto_presentaciones_delete',
  'adicionales_select','adicionales_insert','adicionales_update','adicionales_delete',
  'producto_adicionales_permitidos_select','producto_adicionales_permitidos_insert',
  'producto_adicionales_permitidos_update','producto_adicionales_permitidos_delete',
  'venta_item_adicionales_select','venta_item_adicionales_insert',
  'venta_item_adicionales_update','venta_item_adicionales_delete'
)
UNION ALL
SELECT 'trigger', tgname, tgrelid::regclass::text
FROM pg_trigger WHERE tgname IN ('tg_presentaciones_touch','tg_adicionales_touch')
UNION ALL
SELECT 'function', 'acaihouse._touch_updated_at',''
WHERE to_regprocedure('acaihouse._touch_updated_at()') IS NOT NULL;

\echo ''
\echo '== 4b. Confirmar aislamiento: ¿tocaríamos otros schemas? =='
-- Las migraciones referencian SOLO `acaihouse.*` y `extensions.gen_random_uuid`.
-- Esto es estático; confirmamos que no hay un schema homónimo en otro tenant
-- que podría confundirse.
SELECT nspname AS schema_existente
FROM pg_namespace
WHERE nspname IN ('acaihouse','zentra_erp','enlodemari','reservacaacupe','public','extensions');

\echo ''
\echo '== 5. Volumen de datos operativos (orden de magnitud) =='
SELECT 'ventas'                 AS tabla, count(*) FROM acaihouse.ventas
UNION ALL SELECT 'ventas_items',           count(*) FROM acaihouse.ventas_items
UNION ALL SELECT 'productos',              count(*) FROM acaihouse.productos
UNION ALL SELECT 'movimientos_inventario', count(*) FROM acaihouse.movimientos_inventario
UNION ALL SELECT 'cuentas_por_cobrar',     count(*) FROM acaihouse.cuentas_por_cobrar
UNION ALL SELECT 'clientes',               count(*) FROM acaihouse.clientes
UNION ALL SELECT 'categorias_productos',   count(*) FROM acaihouse.categorias_productos
ORDER BY tabla;

\echo ''
\echo '== 5b. Marca temporal de la última venta registrada =='
SELECT max(fecha) AS ultima_venta, max(created_at) AS ultima_venta_creada
FROM acaihouse.ventas;

\echo ''
\echo '== 6. Pistas de respaldo =='
-- Supabase Pro corre PITR automático. Esto depende del plan; lo confirma el
-- dashboard. Igual dejamos constancia del WAL actual (orientativo) y de si el
-- usuario conectado puede ver pg_stat_archiver.
SELECT pg_current_wal_lsn() AS wal_actual;
SELECT last_archived_time FROM pg_stat_archiver;
