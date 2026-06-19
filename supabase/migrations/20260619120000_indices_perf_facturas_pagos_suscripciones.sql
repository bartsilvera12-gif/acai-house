-- =============================================================================
-- Índices compuestos de performance para queries multi-tenant frecuentes.
--
-- Las tablas ya tienen índices simples por empresa_id y por cliente_id, pero
-- las queries reales casi siempre filtran por AMBAS columnas a la vez
-- (multi-tenant + filtro de negocio). Postgres no combina dos índices simples
-- eficientemente — un índice compuesto es 1-2 órdenes de magnitud más rápido.
--
-- Schema-local y aditivo (CREATE INDEX IF NOT EXISTS).
-- =============================================================================

DO $$
DECLARE
  sch text := 'acaihouse';
BEGIN
  -- facturas(empresa_id, cliente_id): listado de facturas por cliente dentro
  -- de la empresa (estado de cuenta, historial de cobros).
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS ix_facturas_empresa_cliente ON %I.facturas (empresa_id, cliente_id)',
    sch
  );

  -- pagos(empresa_id, created_at DESC): "últimos pagos" del tenant —
  -- consultado por reportes de Gerencia, conciliación y módulo de Pagos.
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS ix_pagos_empresa_created_at ON %I.pagos (empresa_id, created_at DESC)',
    sch
  );

  -- suscripciones(empresa_id, cliente_id, estado): MRR / activas por cliente,
  -- cancelaciones — usado por v_mrr y v_clientes_recurrentes del módulo Gerencia.
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS ix_suscripciones_empresa_cliente_estado ON %I.suscripciones (empresa_id, cliente_id, estado)',
    sch
  );

  RAISE NOTICE '[perf] índices compuestos creados en schema %.', sch;
END $$;
