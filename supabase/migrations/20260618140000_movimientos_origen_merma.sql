-- Permite registrar pérdidas / mermas como origen de movimiento de inventario.
-- El cliente puede dar de baja stock de materias primas (ej. bananas, manzanas)
-- que se pierden, generando un movimiento SALIDA con origen 'merma' para
-- hacer seguimiento de lo perdido en el mes.
--
-- Se aplica sobre el schema activo (search_path lo fija el runner según
-- NEURA_CLIENT_SCHEMA). Idempotente: recrea el CHECK agregando 'merma'.

alter table movimientos_inventario
  drop constraint if exists movimientos_inventario_origen_check;

alter table movimientos_inventario
  add constraint movimientos_inventario_origen_check
  check (origen in ('compra', 'venta', 'ajuste_manual', 'inventario_inicial', 'produccion', 'merma'));
