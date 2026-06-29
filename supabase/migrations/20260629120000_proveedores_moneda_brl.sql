-- Ampliar las monedas permitidas en proveedores para incluir Reales (BRL).
-- Cambio no destructivo: solo extiende el CHECK existente (GS, USD) con BRL.
-- Idempotente. Apunta únicamente al schema acaihouse (instancia monocliente Açaí House).
DO $$
DECLARE sch text := 'acaihouse';
BEGIN
  IF to_regclass(format('%I.proveedores', sch)) IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE %I.proveedores DROP CONSTRAINT IF EXISTS proveedores_moneda_preferida_check',
      sch
    );
    EXECUTE format(
      $f$ALTER TABLE %I.proveedores
           ADD CONSTRAINT proveedores_moneda_preferida_check
           CHECK (moneda_preferida IS NULL OR moneda_preferida = ANY (ARRAY['GS','USD','BRL']))$f$,
      sch
    );
    RAISE NOTICE '[moneda] BRL habilitado en %.proveedores', sch;
  END IF;
END $$;
