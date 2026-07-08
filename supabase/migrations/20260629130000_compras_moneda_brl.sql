-- Ampliar las monedas permitidas en compras para incluir Reales (BRL).
-- Cambio no destructivo: solo extiende el CHECK existente (PYG, USD) con BRL.
-- El costo en guaraníes ya se calcula vía tipo_cambio (mecanismo existente para USD).
-- Idempotente. Apunta únicamente al schema acaihouse (instancia monocliente Açaí House).
DO $$
DECLARE sch text := 'acaihouse';
BEGIN
  IF to_regclass(format('%I.compras', sch)) IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE %I.compras DROP CONSTRAINT IF EXISTS compras_moneda_check',
      sch
    );
    EXECUTE format(
      $f$ALTER TABLE %I.compras
           ADD CONSTRAINT compras_moneda_check
           CHECK (moneda = ANY (ARRAY['PYG','USD','BRL']))$f$,
      sch
    );
    RAISE NOTICE '[moneda] BRL habilitado en %.compras', sch;
  END IF;
END $$;
