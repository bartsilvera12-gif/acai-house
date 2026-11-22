-- Fase 1 - Hardening de permisos
-- Retira privilegios directos del rol `anon` sobre las 4 tablas creadas
-- por las migraciones 20261120120000 y 20261120130000, sin modificar los
-- default privileges del schema ni tocar otras tablas.
--
-- Justificación:
--   El default privileges del schema `acaihouse` otorga DML a `anon` sobre
--   toda nueva tabla, igual que al resto. La seguridad real se mantiene
--   por RLS, pero para estas 4 tablas aplicamos defense-in-depth: se
--   retira cualquier privilegio directo a `anon`. Las policies RLS y los
--   GRANTs a `authenticated` y `service_role` permanecen intactos.
--
-- Alcance exclusivo:
--   acaihouse.producto_presentaciones
--   acaihouse.adicionales
--   acaihouse.producto_adicionales_permitidos
--   acaihouse.venta_item_adicionales

BEGIN;

REVOKE ALL PRIVILEGES ON TABLE acaihouse.producto_presentaciones         FROM anon;
REVOKE ALL PRIVILEGES ON TABLE acaihouse.adicionales                     FROM anon;
REVOKE ALL PRIVILEGES ON TABLE acaihouse.producto_adicionales_permitidos FROM anon;
REVOKE ALL PRIVILEGES ON TABLE acaihouse.venta_item_adicionales          FROM anon;

COMMIT;
