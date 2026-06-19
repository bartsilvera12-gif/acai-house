-- =============================================================================
-- Reparación de RLS para tablas sin RLS o sin policies en acaihouse.
--
-- Detectado por scripts/audit-rls.cjs:
--   · 8 tablas SIN RLS habilitado (financieros incluidos)
--   · 10 tablas con RLS pero sin policies (deny-all silencioso)
--
-- Solución aditiva e idempotente:
--   · Para tablas con `empresa_id`: ENABLE RLS + 4 policies estándar usando
--     puede_acceder_empresa (mismo patrón que el resto del schema).
--   · Para `plan_categoria` (catálogo no tenant-scoped, sin empresa_id):
--     SELECT abierto a authenticated/service_role; escrituras bloqueadas a
--     todos los roles client-side.
-- =============================================================================

DO $$
DECLARE
  sch text := 'acaihouse';
  -- Tablas con empresa_id que requieren RLS + 4 policies estándar.
  tbl text;
  pol_prefix text;
  policy_action text;
  policy_cmd text;
  has_rls boolean;
  needs_table_op boolean;
  tablas_empresa text[] := ARRAY[
    -- Sin RLS al momento de la auditoría
    'cobros_clientes',
    'cuentas_por_cobrar',
    'presupuesto_items',
    'presupuestos',
    'produccion_items',
    'producciones',
    'recibos_dinero',
    -- Con RLS pero sin policies
    'categorias_productos',
    'empresa_autoimpresor_config',
    'empresa_facturacion_modo',
    'factura_correlativos',
    'imports_audit',
    'inventario_stock_ubicacion',
    'inventario_ubicaciones',
    'omnichannel_routes',
    'producto_categorias',
    'productos_codigo_secuencia'
  ];
BEGIN
  -- ── Tablas tenant-scoped (con empresa_id) ───────────────────────────────────
  FOREACH tbl IN ARRAY tablas_empresa LOOP
    IF to_regclass(format('%I.%I', sch, tbl)) IS NULL THEN
      RAISE NOTICE '[rls-repair] tabla %.% no existe, omitida.', sch, tbl;
      CONTINUE;
    END IF;

    -- ENABLE ROW LEVEL SECURITY (idempotente: si ya está, no hace nada).
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', sch, tbl);

    -- 4 policies estándar usando puede_acceder_empresa(empresa_id).
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON %I.%I', tbl, sch, tbl);
    EXECUTE format(
      'CREATE POLICY %I_select ON %I.%I FOR SELECT USING (%I.puede_acceder_empresa(empresa_id))',
      tbl, sch, tbl, sch
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_insert ON %I.%I', tbl, sch, tbl);
    EXECUTE format(
      'CREATE POLICY %I_insert ON %I.%I FOR INSERT WITH CHECK (%I.puede_acceder_empresa(empresa_id))',
      tbl, sch, tbl, sch
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_update ON %I.%I', tbl, sch, tbl);
    EXECUTE format(
      'CREATE POLICY %I_update ON %I.%I FOR UPDATE USING (%I.puede_acceder_empresa(empresa_id)) WITH CHECK (%I.puede_acceder_empresa(empresa_id))',
      tbl, sch, tbl, sch, sch
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_delete ON %I.%I', tbl, sch, tbl);
    EXECUTE format(
      'CREATE POLICY %I_delete ON %I.%I FOR DELETE USING (%I.puede_acceder_empresa(empresa_id))',
      tbl, sch, tbl, sch
    );

    RAISE NOTICE '[rls-repair] OK tabla %.%', sch, tbl;
  END LOOP;

  -- ── Catálogos sin empresa_id ────────────────────────────────────────────────
  -- plan_categoria: clasifica planes del módulo Gerencia. Read-only para clientes.
  IF to_regclass(format('%I.plan_categoria', sch)) IS NOT NULL THEN
    EXECUTE format('ALTER TABLE %I.plan_categoria ENABLE ROW LEVEL SECURITY', sch);
    EXECUTE format('DROP POLICY IF EXISTS plan_categoria_select ON %I.plan_categoria', sch);
    EXECUTE format(
      'CREATE POLICY plan_categoria_select ON %I.plan_categoria FOR SELECT USING (true)',
      sch
    );
    -- Escrituras solo via service_role (la policy con WITH CHECK (false) bloquea
    -- anon/authenticated, pero service_role bypassea RLS por diseño Supabase).
    EXECUTE format('DROP POLICY IF EXISTS plan_categoria_no_writes ON %I.plan_categoria', sch);
    EXECUTE format(
      'CREATE POLICY plan_categoria_no_writes ON %I.plan_categoria FOR ALL USING (false) WITH CHECK (false)',
      sch
    );
    RAISE NOTICE '[rls-repair] OK catálogo %.plan_categoria', sch;
  END IF;

  RAISE NOTICE '[rls-repair] reparación completada.';
END $$;
