// Fase 2.2 Parte 4 — tests de integración REALES de atomicidad y concurrencia.
//
// EXIGE una base STAGING AISLADA. Lee `STAGING_PG_URL` del entorno; si no
// está definida, SALTA con mensaje claro. NO corre contra la base productiva.
//
// Para levantar una staging local con los mínimos necesarios:
//   docker run -d --name acai-staging -p 55432:5432 -e POSTGRES_PASSWORD=secret postgres:15-alpine
//   psql ... < scripts/_seed-staging.sql   # crea el schema acaihouse con las
//                                           # tablas mínimas y los productos
//                                           # necesarios para estos tests.
//   STAGING_PG_URL=postgres://postgres:secret@127.0.0.1:55432/postgres \
//     node scripts/test-fase22p4-atomicidad.cjs
//
// Cobertura:
//   T1. Venta + item + adicional + variante + stock_delta → persisten.
//       Snapshot de costo = productos.costo_promedio del server, NO del cliente.
//   T2. Error en una variante (opcion_id inexistente) → rollback total.
//   T3. Venta sin variantes se persiste normalmente.
//   T4. Stock_delta sobre producto inexistente → rollback.
//   T5. UNIQUE (venta_item_id, grupo_codigo) rechaza duplicados.
//   T6. Dos ventas concurrentes del mismo insumo (lost-update test): el
//       descuento final = suma de ambos deltas sin pérdida gracias a FOR UPDATE.
//   T7. permitir_sin_stock=false con stock insuficiente → abort, 0 cambios.
//   T8. Venta a crédito → cuentas_por_cobrar se crea atómico con la venta.

const path = require("path");
const fs = require("fs");
const pg = require("pg");
const { randomUUID } = require("node:crypto");

const url = process.env.STAGING_PG_URL;
if (!url) {
  console.log("SKIP — STAGING_PG_URL no está definida. Este test NO corre contra la base productiva.");
  console.log("");
  console.log("Para habilitarlo, levantá una staging aislada:");
  console.log("  docker run -d --name acai-staging -p 55432:5432 -e POSTGRES_PASSWORD=secret postgres:15-alpine");
  console.log("  STAGING_PG_URL=postgres://postgres:secret@127.0.0.1:55432/postgres node scripts/test-fase22p4-atomicidad.cjs");
  process.exit(0);
}

const MIG_TABLAS = path.resolve(__dirname, "..", "supabase", "acaihouse", "migrations", "20261125120000_fase22p4_variantes_recetas.sql");
const MIG_FN = path.resolve(__dirname, "..", "supabase", "acaihouse", "migrations", "20261125130000_fase22p4_fn_crear_venta_atomica.sql");

// IDs ficticios que reutilizamos en seed + tests.
const EMPRESA = "a9276529-bca9-418a-b014-375e68d667d2";
const PROD_TRAD = "044bcd13-1e0f-40db-a070-d45d8003c936";
const PRES_CHI = "fbe14515-61c5-4ae9-a785-9f9c6b1e3dbe";
const PROD_REVENTA = "99999999-1111-1111-1111-111111111111";  // GASEOSA-like

// ───────── Seed mínimo del schema acaihouse ─────────
const SEED_SCHEMA = `
CREATE SCHEMA IF NOT EXISTS acaihouse;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS acaihouse.productos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  sku text NOT NULL,
  nombre text NOT NULL,
  unidad_medida text NOT NULL,
  unidad_compra text,
  unidad_receta text,
  factor_compra_receta numeric,
  es_insumo boolean NOT NULL DEFAULT false,
  es_vendible boolean NOT NULL DEFAULT false,
  controla_stock boolean NOT NULL DEFAULT false,
  valorizado boolean NOT NULL DEFAULT true,
  activo boolean NOT NULL DEFAULT true,
  costo_promedio numeric NOT NULL DEFAULT 0,
  stock_actual numeric NOT NULL DEFAULT 0,
  modo_receta text,
  categoria_principal_id uuid,
  peso_variable boolean,
  CONSTRAINT productos_empresa_sku_uq UNIQUE (empresa_id, sku)
);

CREATE TABLE IF NOT EXISTS acaihouse.producto_presentaciones (
  id uuid PRIMARY KEY,
  empresa_id uuid NOT NULL,
  producto_id uuid NOT NULL REFERENCES acaihouse.productos(id),
  nombre text NOT NULL,
  precio numeric NOT NULL,
  orden int DEFAULT 0,
  activo boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS acaihouse.recetas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  producto_id uuid NOT NULL REFERENCES acaihouse.productos(id),
  presentacion_id uuid REFERENCES acaihouse.producto_presentaciones(id),
  nombre text,
  rendimiento_cantidad numeric NOT NULL DEFAULT 1,
  rendimiento_unidad text,
  notas text,
  activa boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS acaihouse.receta_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  receta_id uuid NOT NULL REFERENCES acaihouse.recetas(id) ON DELETE CASCADE,
  insumo_producto_id uuid NOT NULL REFERENCES acaihouse.productos(id),
  cantidad numeric NOT NULL,
  unidad_medida text,
  merma_pct numeric NOT NULL DEFAULT 0,
  orden int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS acaihouse.ventas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  cliente_id uuid,
  numero_control text NOT NULL,
  moneda text NOT NULL,
  tipo_cambio numeric NOT NULL,
  subtotal numeric NOT NULL,
  monto_iva numeric NOT NULL,
  total numeric NOT NULL,
  estado text NOT NULL,
  tipo_venta text NOT NULL,
  plazo_dias int,
  fecha timestamptz NOT NULL,
  observaciones text,
  metodo_pago text,
  caja_id uuid,
  genera_nota_remision boolean NOT NULL DEFAULT false,
  nota_remision_numero text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS acaihouse.ventas_items (
  id uuid PRIMARY KEY,
  empresa_id uuid NOT NULL,
  venta_id uuid NOT NULL REFERENCES acaihouse.ventas(id) ON DELETE CASCADE,
  producto_id uuid NOT NULL,
  producto_nombre text NOT NULL,
  sku text NOT NULL,
  cantidad numeric NOT NULL,
  precio_venta_original numeric NOT NULL,
  precio_venta numeric NOT NULL,
  tipo_iva text NOT NULL,
  tipo_precio text NOT NULL,
  subtotal numeric NOT NULL,
  monto_iva numeric NOT NULL,
  total_linea numeric NOT NULL,
  nota text,
  presentacion_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS acaihouse.venta_item_adicionales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  venta_item_id uuid NOT NULL REFERENCES acaihouse.ventas_items(id) ON DELETE CASCADE,
  adicional_id uuid,
  adicional_nombre text NOT NULL,
  precio_unitario numeric NOT NULL,
  cantidad int NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS acaihouse.movimientos_inventario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  producto_nombre text NOT NULL,
  producto_sku text NOT NULL,
  tipo text NOT NULL,
  cantidad numeric NOT NULL,
  costo_unitario numeric,
  origen text,
  referencia text,
  fecha timestamptz,
  venta_id uuid,
  created_by uuid,
  usuario_nombre text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  produccion_id uuid
);

CREATE TABLE IF NOT EXISTS acaihouse.cuentas_por_cobrar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  cliente_id uuid,
  venta_id uuid NOT NULL,
  numero_venta text,
  fecha_emision date,
  fecha_vencimiento date,
  moneda text,
  total numeric,
  saldo numeric,
  estado text
);

-- Función RLS placeholder (en staging no hay auth real).
CREATE OR REPLACE FUNCTION acaihouse.puede_acceder_empresa(empresa_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS 'SELECT true';

-- Roles base para que los GRANT no fallen.
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`;

const SEED_DATA = `
-- Fixture mínimo: 1 producto preparado (Tradicional) + 1 presentación (Chico) + 1 insumo + 1 receta.
INSERT INTO acaihouse.productos (id, empresa_id, sku, nombre, unidad_medida, unidad_compra, unidad_receta,
  factor_compra_receta, es_insumo, es_vendible, controla_stock, valorizado, activo, costo_promedio, stock_actual)
VALUES
  ('${PROD_TRAD}', '${EMPRESA}', 'ACAI_TRAD_001', 'Tradicional', 'UNIDAD', NULL, NULL, NULL,
   false, true, false, true, true, 0, 0),
  ('11111111-1111-1111-1111-111111111111', '${EMPRESA}', 'MP-TEST-A', 'Crema test A', 'G', 'KG', 'G', 1000,
   true, false, true, true, true, 150, 5000),
  ('22222222-2222-2222-2222-222222222222', '${EMPRESA}', 'MP-TEST-B', 'Crema test B', 'G', 'KG', 'G', 1000,
   true, false, true, true, true, 200, 5000),
  ('${PROD_REVENTA}', '${EMPRESA}', 'REV-TEST', 'Gaseosa test', 'UNIDAD', NULL, NULL, NULL,
   false, true, true, true, true, 3000, 10)
ON CONFLICT (empresa_id, sku) DO NOTHING;

INSERT INTO acaihouse.producto_presentaciones (id, empresa_id, producto_id, nombre, precio, orden, activo)
VALUES ('${PRES_CHI}', '${EMPRESA}', '${PROD_TRAD}', 'Chico', 14000, 1, true)
ON CONFLICT (id) DO NOTHING;
`;

const EMPRESA_OTRA = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const INS_A = "11111111-1111-1111-1111-111111111111";
const INS_B = "22222222-2222-2222-2222-222222222222";

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  OK   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

function stripOuterTx(sql) {
  return sql.replace(/^\s*BEGIN\s*;/i, "").replace(/\s*COMMIT\s*;\s*$/i, "");
}

async function newClient() {
  const c = new pg.Client({ connectionString: url, application_name: "test-atomic" });
  await c.connect();
  return c;
}

(async () => {
  // 1) Preparar schema + migraciones + seed en la staging.
  const c = await newClient();
  console.log("  SET-UP: aplicando schema base + migraciones Fase 2.2 Parte 4 + seed…");
  await c.query(SEED_SCHEMA);
  await c.query(stripOuterTx(fs.readFileSync(MIG_TABLAS, "utf8")));
  await c.query(stripOuterTx(fs.readFileSync(MIG_FN, "utf8")));
  await c.query(SEED_DATA);

  // Crear una receta de prueba + un grupo + 2 opciones para usar en los tests.
  const recetaIns = await c.query(
    "INSERT INTO acaihouse.recetas (empresa_id, producto_id, presentacion_id, rendimiento_cantidad, rendimiento_unidad, activa) VALUES ($1,$2,$3,1,'UNIDAD',true) RETURNING id",
    [EMPRESA, PROD_TRAD, PRES_CHI]
  );
  const recetaId = recetaIns.rows[0].id;
  const grupoIns = await c.query(
    "INSERT INTO acaihouse.receta_grupos_variante (empresa_id, receta_id, codigo, etiqueta, obligatorio, orden) VALUES ($1,$2,'chocolate','Chocolate',true,1) RETURNING id",
    [EMPRESA, recetaId]
  );
  const grupoId = grupoIns.rows[0].id;
  const opAIns = await c.query(
    "INSERT INTO acaihouse.receta_grupo_opciones (empresa_id, grupo_id, insumo_producto_id, cantidad, unidad_medida, merma_pct, etiqueta, orden) VALUES ($1,$2,$3,20,'G',0,'Opcion A',1) RETURNING id",
    [EMPRESA, grupoId, INS_A]
  );
  const opA = opAIns.rows[0].id;
  const opBIns = await c.query(
    "INSERT INTO acaihouse.receta_grupo_opciones (empresa_id, grupo_id, insumo_producto_id, cantidad, unidad_medida, merma_pct, etiqueta, orden) VALUES ($1,$2,$3,25,'G',0,'Opcion B',2) RETURNING id",
    [EMPRESA, grupoId, INS_B]
  );
  const opB = opBIns.rows[0].id;

  // ─────── Tests ───────
  await test("T1 — venta + item + variante + stock_delta persisten atómicamente", async () => {
    const itemId = randomUUID();
    const payload = {
      empresa_id: EMPRESA,
      permitir_sin_stock: false,
      venta: makeVenta("T1"),
      items: [makeItem(itemId, PROD_TRAD, "Tradicional", "ACAI_TRAD_001", 1, 10000, PRES_CHI, [
        { grupo_id: grupoId, opcion_id: opA },
      ])],
      cxc: null,
      stock_deltas: [
        { producto_id: INS_A, delta_qty: 20, movimiento: { referencia: "VTA-T1" } },
      ],
    };
    const r = await c.query("SELECT venta_id FROM acaihouse.fn_crear_venta_atomica($1)", [JSON.stringify(payload)]);
    const ventaId = r.rows[0].venta_id;
    if (!ventaId) throw new Error("no venta_id");

    const v = (await c.query("SELECT costo_unitario_snapshot::text AS c FROM acaihouse.venta_item_variantes WHERE venta_item_id=$1", [itemId])).rows[0];
    // El snapshot debe ser 150 — el costo_promedio del INS_A en la DB (server-side), no del cliente.
    if (Number(v.c) !== 150) throw new Error(`costo_unitario_snapshot=${v.c} (esperaba 150)`);

    const m = (await c.query("SELECT costo_unitario::text AS c, cantidad::text AS q FROM acaihouse.movimientos_inventario WHERE venta_id=$1 AND producto_id=$2", [ventaId, INS_A])).rows[0];
    if (Number(m.c) !== 150) throw new Error(`movimiento costo_unitario=${m.c}`);
    if (Number(m.q) !== 20) throw new Error(`movimiento cantidad=${m.q}`);

    const stock = (await c.query("SELECT stock_actual::text AS s FROM acaihouse.productos WHERE id=$1", [INS_A])).rows[0];
    if (Number(stock.s) !== 4980) throw new Error(`stock INS_A=${stock.s} (esperaba 4980)`);
  });

  await test("T2 — opcion_id inexistente → rollback total", async () => {
    const itemId = randomUUID();
    const payload = {
      empresa_id: EMPRESA, permitir_sin_stock: false,
      venta: makeVenta("T2"),
      items: [makeItem(itemId, PROD_TRAD, "Tradicional", "ACAI_TRAD_001", 1, 10000, PRES_CHI, [
        { grupo_id: grupoId, opcion_id: "00000000-0000-0000-0000-000000000000" },
      ])],
      cxc: null, stock_deltas: [],
    };
    let threw = false;
    try { await c.query("SELECT venta_id FROM acaihouse.fn_crear_venta_atomica($1)", [JSON.stringify(payload)]); } catch { threw = true; }
    if (!threw) throw new Error("esperaba error");
    const n = (await c.query("SELECT count(*)::int AS n FROM acaihouse.ventas_items WHERE id=$1", [itemId])).rows[0].n;
    if (n !== 0) throw new Error("item quedó");
  });

  await test("T3 — venta sin variantes se persiste normalmente", async () => {
    const itemId = randomUUID();
    const payload = {
      empresa_id: EMPRESA, permitir_sin_stock: false,
      venta: makeVenta("T3"),
      items: [makeItem(itemId, PROD_REVENTA, "Gaseosa test", "REV-TEST", 1, 5000, null, [])],
      cxc: null, stock_deltas: [
        { producto_id: PROD_REVENTA, delta_qty: 1, movimiento: { referencia: "VTA-T3" } },
      ],
    };
    const r = await c.query("SELECT venta_id FROM acaihouse.fn_crear_venta_atomica($1)", [JSON.stringify(payload)]);
    if (!r.rows[0].venta_id) throw new Error("no venta_id");
    const stock = (await c.query("SELECT stock_actual::text AS s FROM acaihouse.productos WHERE id=$1", [PROD_REVENTA])).rows[0];
    if (Number(stock.s) !== 9) throw new Error(`stock REV=${stock.s} (esperaba 9)`);
  });

  await test("T4 — stock_delta de producto inexistente → rollback", async () => {
    const itemId = randomUUID();
    const payload = {
      empresa_id: EMPRESA, permitir_sin_stock: false,
      venta: makeVenta("T4"),
      items: [makeItem(itemId, PROD_TRAD, "Tradicional", "ACAI_TRAD_001", 1, 10000, PRES_CHI, [])],
      cxc: null,
      stock_deltas: [{ producto_id: "00000000-0000-0000-0000-000000000000", delta_qty: 1, movimiento: null }],
    };
    let threw = false;
    try { await c.query("SELECT venta_id FROM acaihouse.fn_crear_venta_atomica($1)", [JSON.stringify(payload)]); } catch { threw = true; }
    if (!threw) throw new Error("esperaba error");
    const n = (await c.query("SELECT count(*)::int AS n FROM acaihouse.ventas_items WHERE id=$1", [itemId])).rows[0].n;
    if (n !== 0) throw new Error("item quedó");
  });

  await test("T5 — UNIQUE (venta_item_id, grupo_codigo) rechaza duplicados", async () => {
    const itemId = randomUUID();
    const payload = {
      empresa_id: EMPRESA, permitir_sin_stock: false,
      venta: makeVenta("T5"),
      items: [makeItem(itemId, PROD_TRAD, "Tradicional", "ACAI_TRAD_001", 1, 10000, PRES_CHI, [
        { grupo_id: grupoId, opcion_id: opA },
        { grupo_id: grupoId, opcion_id: opB },
      ])],
      cxc: null, stock_deltas: [],
    };
    let threw = false;
    try { await c.query("SELECT venta_id FROM acaihouse.fn_crear_venta_atomica($1)", [JSON.stringify(payload)]); } catch { threw = true; }
    if (!threw) throw new Error("esperaba unique violation");
  });

  await test("T6 — concurrencia FOR UPDATE: 2 ventas simultáneas descuentan sin perder updates", async () => {
    // Snapshot del stock actual.
    const antes = Number((await c.query("SELECT stock_actual::text AS s FROM acaihouse.productos WHERE id=$1", [INS_B])).rows[0].s);
    const c1 = await newClient();
    const c2 = await newClient();
    try {
      // Dos ventas simultáneas descontando 100 g cada una del mismo insumo B.
      const mk = (ref) => ({
        empresa_id: EMPRESA, permitir_sin_stock: false,
        venta: makeVenta(ref),
        items: [makeItem(randomUUID(), PROD_TRAD, "Tradicional", "ACAI_TRAD_001", 1, 10000, PRES_CHI, [])],
        cxc: null,
        stock_deltas: [{ producto_id: INS_B, delta_qty: 100, movimiento: { referencia: ref } }],
      });
      const p1 = c1.query("SELECT venta_id FROM acaihouse.fn_crear_venta_atomica($1)", [JSON.stringify(mk("CONC-A"))]);
      const p2 = c2.query("SELECT venta_id FROM acaihouse.fn_crear_venta_atomica($1)", [JSON.stringify(mk("CONC-B"))]);
      await Promise.all([p1, p2]);
      const despues = Number((await c.query("SELECT stock_actual::text AS s FROM acaihouse.productos WHERE id=$1", [INS_B])).rows[0].s);
      // Sin FOR UPDATE: lost-update → stock final = antes - 100 (una venta se pierde).
      // Con FOR UPDATE: stock final = antes - 200.
      if (despues !== antes - 200) throw new Error(`stock final=${despues} (esperaba ${antes - 200}) — hay lost-update`);
    } finally {
      await c1.end(); await c2.end();
    }
  });

  await test("T7 — permitir_sin_stock=false con stock insuficiente → abort, sin cambios", async () => {
    const itemId = randomUUID();
    const stockAntes = Number((await c.query("SELECT stock_actual::text AS s FROM acaihouse.productos WHERE id=$1", [INS_A])).rows[0].s);
    const payload = {
      empresa_id: EMPRESA, permitir_sin_stock: false,
      venta: makeVenta("T7"),
      items: [makeItem(itemId, PROD_TRAD, "Tradicional", "ACAI_TRAD_001", 1, 10000, PRES_CHI, [])],
      cxc: null,
      stock_deltas: [{ producto_id: INS_A, delta_qty: stockAntes + 10000, movimiento: { referencia: "T7" } }],
    };
    let threw = false;
    try { await c.query("SELECT venta_id FROM acaihouse.fn_crear_venta_atomica($1)", [JSON.stringify(payload)]); } catch { threw = true; }
    if (!threw) throw new Error("esperaba error de stock insuficiente");
    const n = (await c.query("SELECT count(*)::int AS n FROM acaihouse.ventas_items WHERE id=$1", [itemId])).rows[0].n;
    if (n !== 0) throw new Error("item quedó");
    const stockDespues = Number((await c.query("SELECT stock_actual::text AS s FROM acaihouse.productos WHERE id=$1", [INS_A])).rows[0].s);
    if (stockDespues !== stockAntes) throw new Error(`stock cambió: ${stockAntes} → ${stockDespues}`);
  });

  await test("T8 — venta a crédito con CxC creada atómicamente", async () => {
    const itemId = randomUUID();
    const clienteId = randomUUID();
    const payload = {
      empresa_id: EMPRESA, permitir_sin_stock: false,
      venta: { ...makeVenta("T8"), tipo_venta: "CREDITO", plazo_dias: 30, cliente_id: clienteId },
      items: [makeItem(itemId, PROD_TRAD, "Tradicional", "ACAI_TRAD_001", 1, 10000, PRES_CHI, [])],
      cxc: { numero_cuota: 1, monto: 10000, saldo: 10000, fecha_vencimiento: "2027-01-01" },
      stock_deltas: [],
    };
    const r = await c.query("SELECT venta_id FROM acaihouse.fn_crear_venta_atomica($1)", [JSON.stringify(payload)]);
    const ventaId = r.rows[0].venta_id;
    const cxc = (await c.query("SELECT estado, saldo::text AS saldo FROM acaihouse.cuentas_por_cobrar WHERE venta_id=$1", [ventaId])).rows[0];
    if (!cxc || cxc.estado !== "pendiente" || Number(cxc.saldo) !== 10000) throw new Error(`cxc=${JSON.stringify(cxc)}`);
  });

  console.log(`\n=== RESULT: ${passed} OK, ${failed} FAIL ===`);
  await c.end();
  if (failed > 0) process.exit(1);
})().catch((e) => { console.error("ERROR global:", e.message, e.stack); process.exit(1); });

// ───────── Helpers ─────────
function makeVenta(ref) {
  return {
    numero_control: "TEST-" + ref + "-" + Math.floor(Math.random() * 1e6),
    fecha: new Date().toISOString(),
    total: 10000, subtotal: 10000, monto_iva: 0, tipo_iva_resumen: "EXENTA",
    tipo_venta: "CONTADO", plazo_dias: null, fecha_vencimiento: null,
    moneda: "GS", tipo_cambio: 1, cliente_id: null, observaciones: null,
    metodo_pago: "efectivo", caja_id: null,
    genera_nota_remision: false, nota_remision_numero: null,
  };
}
function makeItem(id, prodId, prodNombre, sku, cantidad, precio, presentacion_id, variantes) {
  return {
    id, producto_id: prodId, producto_nombre: prodNombre, sku,
    cantidad, precio_venta_original: precio, precio_venta: precio,
    tipo_iva: "EXENTA", tipo_precio: "minorista",
    subtotal: precio * cantidad, monto_iva: 0, total_linea: precio * cantidad,
    presentacion_id, variantes, adicionales: [],
  };
}
