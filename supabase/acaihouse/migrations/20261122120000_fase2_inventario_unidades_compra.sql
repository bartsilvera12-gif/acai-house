-- Fase 2 Parte 1 — Inventario, unidades de compra y conversiones.
-- Migración 100% aditiva. No modifica datos existentes, no rompe compatibilidad.
--
-- Columnas agregadas:
--   acaihouse.productos:
--     peso_variable boolean NOT NULL DEFAULT false
--       Marca insumos cuyo empaque pesa distinto cada vez (ej: caja de banana).
--       Cuando es true, la compra debe capturar peso real recibido y NO usa
--       factor_compra_receta configurado del producto.
--
--   acaihouse.compras:
--     cantidad_compra        numeric NULL   -- cuántos empaques se compraron (ej: 2 cajas)
--     unidad_compra_snapshot text    NULL   -- etiqueta del empaque al momento (ej: "Caja 8 kg")
--     factor_aplicado        numeric NULL   -- g por empaque aplicado a esta compra
--     peso_real_recibido     numeric NULL   -- en unidad_medida del producto, solo si peso_variable
--
-- Reglas semánticas (validadas en servidor, no en DB):
--   - producto.peso_variable=false -> factor_aplicado = producto.factor_compra_receta
--                                     cantidad = cantidad_compra * factor_aplicado
--                                     peso_real_recibido = NULL
--   - producto.peso_variable=true  -> peso_real_recibido NOT NULL
--                                     cantidad = peso_real_recibido
--                                     factor_aplicado = peso_real_recibido / cantidad_compra (ad-hoc)
--
-- Las 4 columnas de compras son opcionales: compras existentes (0 filas hoy)
-- y futuras compras "simples" sin empaque configurado pueden dejarlas NULL.

BEGIN;

-- productos.peso_variable
ALTER TABLE acaihouse.productos
  ADD COLUMN IF NOT EXISTS peso_variable boolean NOT NULL DEFAULT false;

-- compras: 4 columnas aditivas
ALTER TABLE acaihouse.compras
  ADD COLUMN IF NOT EXISTS cantidad_compra        numeric NULL;
ALTER TABLE acaihouse.compras
  ADD COLUMN IF NOT EXISTS unidad_compra_snapshot text    NULL;
ALTER TABLE acaihouse.compras
  ADD COLUMN IF NOT EXISTS factor_aplicado        numeric NULL;
ALTER TABLE acaihouse.compras
  ADD COLUMN IF NOT EXISTS peso_real_recibido     numeric NULL;

-- Comentarios para auditoría
COMMENT ON COLUMN acaihouse.productos.peso_variable IS
  'Fase 2.1: true cuando el empaque de compra tiene peso variable (ej: caja de banana). Obliga a capturar peso real recibido al comprar.';

COMMENT ON COLUMN acaihouse.compras.cantidad_compra IS
  'Fase 2.1: número de empaques comprados en la unidad original (ej: 2 cajas). Puede ser NULL para compras legacy o productos sin unidad_compra configurada.';
COMMENT ON COLUMN acaihouse.compras.unidad_compra_snapshot IS
  'Fase 2.1: etiqueta del empaque en el momento de la compra (ej: "Caja 8 kg"). Snapshot — no cambia si cambia la configuración del producto.';
COMMENT ON COLUMN acaihouse.compras.factor_aplicado IS
  'Fase 2.1: g (o unidad base) por empaque aplicado a esta compra. Peso fijo = producto.factor_compra_receta. Peso variable = peso_real_recibido / cantidad_compra.';
COMMENT ON COLUMN acaihouse.compras.peso_real_recibido IS
  'Fase 2.1: solo cuando producto.peso_variable=true. Peso total recibido en la unidad_medida del producto (ej: 13500 g para 2 cajas de banana).';

COMMIT;
