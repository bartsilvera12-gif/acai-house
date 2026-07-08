-- Agregar nota/variación por ítem de venta (ej: "sin leche condensada").
-- Se usa para la comanda de cocina. Columna opcional, no destructiva. Idempotente.
-- Apunta únicamente al schema acaihouse (instancia monocliente Açaí House).
DO $$
DECLARE sch text := 'acaihouse';
BEGIN
  IF to_regclass(format('%I.ventas_items', sch)) IS NOT NULL THEN
    EXECUTE format('ALTER TABLE %I.ventas_items ADD COLUMN IF NOT EXISTS nota text', sch);
    RAISE NOTICE '[ventas_items] columna nota lista en %.ventas_items', sch;
  END IF;
END $$;
