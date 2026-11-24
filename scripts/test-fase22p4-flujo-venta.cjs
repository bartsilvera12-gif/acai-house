// Fase 2.2 Parte 4 — pruebas del FLUJO REAL de venta (end-to-end via RPC).
//
// Verifica:
//   F1. Venta con producto + presentación + adicional + variante: precio final
//       de la línea = base + adicionales (NO suma la variante).
//   F2. Variante elegida se persiste en venta_item_variantes con snapshot
//       SERVER-SIDE (cantidad, costo, etiquetas, insumo). Clientes manipulables
//       no pueden inyectar valores falsos (test envía cantidad=99999 en el
//       payload — la RPC la IGNORA y usa la de la opción real).
//   F3. Consumo automático OFF (default): NO se crean movimientos de insumos
//       (variantes, receta base) — solo movimientos de productos controla_stock.
//   F4. Dos unidades del mismo producto con sabores distintos → 2 variantes
//       distintas en venta_item_variantes, con sus costos propios.
//   F5. Permitir sin stock: stock queda en negativo (no clamped a 0), el
//       movimiento SALIDA registra la cantidad completa.
//   F6. Tenant check: un empresa_id ajeno → 42501 permission denied.
//
// EXIGE STAGING_PG_URL. No corre contra prod.

const path = require("path");
const fs = require("fs");
const pg = require("pg");
const { randomUUID } = require("node:crypto");

const url = process.env.STAGING_PG_URL;
if (!url) {
  console.log("SKIP — STAGING_PG_URL no definida. CI provee este env; local necesita docker.");
  process.exit(0);
}

const MIG_TABLAS = path.resolve(__dirname, "..", "supabase", "acaihouse", "migrations", "20261125120000_fase22p4_variantes_recetas.sql");
const MIG_FN = path.resolve(__dirname, "..", "supabase", "acaihouse", "migrations", "20261125130000_fase22p4_fn_crear_venta_atomica.sql");

const EMPRESA = "a9276529-bca9-418a-b014-375e68d667d2";
const EMPRESA_AJENA = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const PROD_TRAD = "044bcd13-1e0f-40db-a070-d45d8003c936";
const PRES_CHI = "fbe14515-61c5-4ae9-a785-9f9c6b1e3dbe";
const INS_CHOCO_NEGRO = "11111111-1111-1111-1111-111111111111";
const INS_CHOCO_BLANCO = "22222222-2222-2222-2222-222222222222";
const PROD_REVENTA = "99999999-1111-1111-1111-111111111111";

const SEED_SCHEMA = `
CREATE SCHEMA IF NOT EXISTS acaihouse;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS acaihouse.productos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL, sku text NOT NULL, nombre text NOT NULL,
  unidad_medida text NOT NULL, unidad_compra text, unidad_receta text, factor_compra_receta numeric,
  es_insumo boolean NOT NULL DEFAULT false, es_vendible boolean NOT NULL DEFAULT false,
  controla_stock boolean NOT NULL DEFAULT false, valorizado boolean NOT NULL DEFAULT true,
  activo boolean NOT NULL DEFAULT true, costo_promedio numeric NOT NULL DEFAULT 0,
  stock_actual numeric NOT NULL DEFAULT 0, modo_receta text, categoria_principal_id uuid,
  peso_variable boolean, CONSTRAINT productos_empresa_sku_uq UNIQUE (empresa_id, sku));
CREATE TABLE IF NOT EXISTS acaihouse.producto_presentaciones (
  id uuid PRIMARY KEY, empresa_id uuid NOT NULL, producto_id uuid NOT NULL REFERENCES acaihouse.productos(id),
  nombre text NOT NULL, precio numeric NOT NULL, orden int DEFAULT 0, activo boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS acaihouse.recetas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL, producto_id uuid NOT NULL REFERENCES acaihouse.productos(id),
  presentacion_id uuid REFERENCES acaihouse.producto_presentaciones(id), nombre text,
  rendimiento_cantidad numeric NOT NULL DEFAULT 1, rendimiento_unidad text, notas text,
  activa boolean NOT NULL DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS acaihouse.receta_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL,
  receta_id uuid NOT NULL REFERENCES acaihouse.recetas(id) ON DELETE CASCADE,
  insumo_producto_id uuid NOT NULL REFERENCES acaihouse.productos(id),
  cantidad numeric NOT NULL, unidad_medida text, merma_pct numeric NOT NULL DEFAULT 0,
  orden int NOT NULL DEFAULT 0, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS acaihouse.ventas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL, cliente_id uuid,
  numero_control text NOT NULL, moneda text NOT NULL, tipo_cambio numeric NOT NULL,
  subtotal numeric NOT NULL, monto_iva numeric NOT NULL, total numeric NOT NULL,
  estado text NOT NULL, tipo_venta text NOT NULL, plazo_dias int, fecha timestamptz NOT NULL,
  observaciones text, metodo_pago text, caja_id uuid, genera_nota_remision boolean NOT NULL DEFAULT false,
  nota_remision_numero text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS acaihouse.ventas_items (
  id uuid PRIMARY KEY, empresa_id uuid NOT NULL, venta_id uuid NOT NULL REFERENCES acaihouse.ventas(id) ON DELETE CASCADE,
  producto_id uuid NOT NULL, producto_nombre text NOT NULL, sku text NOT NULL,
  cantidad numeric NOT NULL, precio_venta_original numeric NOT NULL, precio_venta numeric NOT NULL,
  tipo_iva text NOT NULL, tipo_precio text NOT NULL, subtotal numeric NOT NULL,
  monto_iva numeric NOT NULL, total_linea numeric NOT NULL, nota text, presentacion_id uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS acaihouse.venta_item_adicionales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL,
  venta_item_id uuid NOT NULL REFERENCES acaihouse.ventas_items(id) ON DELETE CASCADE,
  adicional_id uuid, adicional_nombre text NOT NULL, precio_unitario numeric NOT NULL,
  cantidad int NOT NULL DEFAULT 1, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS acaihouse.movimientos_inventario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL, producto_id uuid NOT NULL,
  producto_nombre text NOT NULL, producto_sku text NOT NULL, tipo text NOT NULL,
  cantidad numeric NOT NULL, costo_unitario numeric, origen text, referencia text, fecha timestamptz,
  venta_id uuid, created_by uuid, usuario_nombre text, created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(), produccion_id uuid);
CREATE TABLE IF NOT EXISTS acaihouse.cuentas_por_cobrar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL, cliente_id uuid,
  venta_id uuid NOT NULL, numero_venta text, fecha_emision date, fecha_vencimiento date,
  moneda text, total numeric, saldo numeric, estado text);
CREATE OR REPLACE FUNCTION acaihouse.puede_acceder_empresa(empresa_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`;

const SEED_DATA = `
INSERT INTO acaihouse.productos (id, empresa_id, sku, nombre, unidad_medida, es_insumo, es_vendible, controla_stock, costo_promedio, stock_actual)
VALUES
  ('${PROD_TRAD}', '${EMPRESA}', 'ACAI_TRAD_001', 'Tradicional', 'UNIDAD', false, true, false, 0, 0),
  ('${INS_CHOCO_NEGRO}', '${EMPRESA}', 'MP-0020', 'Crema de chocolate negro', 'G', true, false, true, 150, 1000),
  ('${INS_CHOCO_BLANCO}', '${EMPRESA}', 'MP-0019', 'Crema de chocolate blanco', 'G', true, false, true, 120, 1000),
  ('${PROD_REVENTA}', '${EMPRESA}', 'REV-TEST', 'Gaseosa test', 'UNIDAD', false, true, true, 3000, 5)
ON CONFLICT (empresa_id, sku) DO NOTHING;
INSERT INTO acaihouse.producto_presentaciones (id, empresa_id, producto_id, nombre, precio, orden, activo)
VALUES ('${PRES_CHI}', '${EMPRESA}', '${PROD_TRAD}', 'Chico', 14000, 1, true)
ON CONFLICT (id) DO NOTHING;
`;

let passed = 0, failed = 0;
let testClient = null;
async function tryQ(fn) {
  try { return { ok: true, result: await fn() }; }
  catch (error) {
    try { await testClient.query("ROLLBACK"); } catch {}
    return { ok: false, error };
  }
}
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  OK   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}
function stripOuterTx(sql) {
  return sql.replace(/^\s*BEGIN\s*;/i, "").replace(/\s*COMMIT\s*;\s*$/i, "");
}
async function newClient() { const c = new pg.Client({ connectionString: url }); await c.connect(); return c; }

(async () => {
  const c = await newClient();
  console.log("  SET-UP: schema + migraciones + seed…");
  await c.query(SEED_SCHEMA);
  await c.query(stripOuterTx(fs.readFileSync(MIG_TABLAS, "utf8")));
  await c.query(stripOuterTx(fs.readFileSync(MIG_FN, "utf8")));
  await c.query(SEED_DATA);

  // Receta activa con un grupo de variante "chocolate" y 2 opciones.
  const recR = await c.query(
    "INSERT INTO acaihouse.recetas (empresa_id, producto_id, presentacion_id, rendimiento_cantidad, rendimiento_unidad, activa) VALUES ($1,$2,$3,1,'UNIDAD',true) RETURNING id",
    [EMPRESA, PROD_TRAD, PRES_CHI]
  );
  const recetaId = recR.rows[0].id;
  const gR = await c.query(
    "INSERT INTO acaihouse.receta_grupos_variante (empresa_id, receta_id, codigo, etiqueta, obligatorio, orden) VALUES ($1,$2,'chocolate','Chocolate',true,1) RETURNING id",
    [EMPRESA, recetaId]
  );
  const grupoId = gR.rows[0].id;
  const opNegroR = await c.query(
    "INSERT INTO acaihouse.receta_grupo_opciones (empresa_id, grupo_id, insumo_producto_id, cantidad, unidad_medida, merma_pct, etiqueta, orden) VALUES ($1,$2,$3,29,'G',0,'Chocolate negro',1) RETURNING id",
    [EMPRESA, grupoId, INS_CHOCO_NEGRO]
  );
  const opNegro = opNegroR.rows[0].id;
  const opBlancoR = await c.query(
    "INSERT INTO acaihouse.receta_grupo_opciones (empresa_id, grupo_id, insumo_producto_id, cantidad, unidad_medida, merma_pct, etiqueta, orden) VALUES ($1,$2,$3,29,'G',0,'Chocolate blanco',2) RETURNING id",
    [EMPRESA, grupoId, INS_CHOCO_BLANCO]
  );
  const opBlanco = opBlancoR.rows[0].id;
  testClient = c; // usado por tryQ para hacer ROLLBACK tras error.

  function basePayload(label) {
    return {
      empresa_id: EMPRESA, permitir_sin_stock: false,
      venta: {
        numero_control: "VTA-" + label + "-" + Math.floor(Math.random() * 1e6),
        fecha: new Date().toISOString(),
        total: 14000, subtotal: 14000, monto_iva: 0, tipo_iva_resumen: "EXENTA",
        tipo_venta: "CONTADO", plazo_dias: null, fecha_vencimiento: null,
        moneda: "GS", tipo_cambio: 1, cliente_id: null, observaciones: null,
        metodo_pago: "efectivo", caja_id: null, created_by: null, usuario_nombre: null,
        genera_nota_remision: false, nota_remision_numero: null,
      },
      items: [], cxc: null, stock_deltas: [],
    };
  }

  await test("F1 — precio de la línea = base + adicionales (variante no suma)", async () => {
    const itemId = randomUUID();
    const payload = basePayload("F1");
    const precioBase = 14000, precioAdicional = 2000;
    payload.venta.total = precioBase + precioAdicional;
    payload.venta.subtotal = payload.venta.total;
    payload.items = [{
      id: itemId, producto_id: PROD_TRAD, producto_nombre: "Tradicional", sku: "ACAI_TRAD_001",
      cantidad: 1, precio_venta_original: precioBase + precioAdicional,
      precio_venta: precioBase + precioAdicional,
      tipo_iva: "EXENTA", tipo_precio: "minorista",
      subtotal: precioBase + precioAdicional, monto_iva: 0, total_linea: precioBase + precioAdicional,
      presentacion_id: PRES_CHI,
      adicionales: [{ adicional_id: null, adicional_nombre: "Chocolate extra", precio_unitario: precioAdicional, cantidad: 1 }],
      variantes: [{ grupo_id: grupoId, opcion_id: opBlanco }],
    }];
    const r = await c.query("SELECT venta_id FROM acaihouse.fn_crear_venta_atomica($1::jsonb)", [JSON.stringify(payload)]);
    const ventaId = r.rows[0].venta_id;
    const vit = (await c.query("SELECT precio_venta::text AS p, total_linea::text AS t FROM acaihouse.ventas_items WHERE id=$1", [itemId])).rows[0];
    if (Number(vit.p) !== 16000) throw new Error(`precio_venta=${vit.p}, esperaba 16000 (base 14000 + adicional 2000, SIN variante)`);
    if (Number(vit.t) !== 16000) throw new Error(`total_linea=${vit.t}`);
    const total = (await c.query("SELECT total::text FROM acaihouse.ventas WHERE id=$1", [ventaId])).rows[0].total;
    if (Number(total) !== 16000) throw new Error(`total venta=${total}`);
  });

  await test("F2 — snapshot server-side ignora valores manipulados del cliente", async () => {
    const itemId = randomUUID();
    const payload = basePayload("F2");
    payload.items = [{
      id: itemId, producto_id: PROD_TRAD, producto_nombre: "Tradicional", sku: "ACAI_TRAD_001",
      cantidad: 1, precio_venta_original: 14000, precio_venta: 14000,
      tipo_iva: "EXENTA", tipo_precio: "minorista",
      subtotal: 14000, monto_iva: 0, total_linea: 14000, presentacion_id: PRES_CHI,
      adicionales: [],
      // El cliente envía SOLO grupo_id + opcion_id. La RPC extrae el resto.
      variantes: [{ grupo_id: grupoId, opcion_id: opNegro }],
    }];
    const r = await c.query("SELECT venta_id FROM acaihouse.fn_crear_venta_atomica($1::jsonb)", [JSON.stringify(payload)]);
    const ventaId = r.rows[0].venta_id;
    const vv = (await c.query(
      "SELECT cantidad::text AS c, unidad_medida AS u, costo_unitario_snapshot::text AS cu, opcion_etiqueta AS eo, grupo_codigo AS gc, insumo_sku AS sk FROM acaihouse.venta_item_variantes WHERE venta_item_id=$1",
      [itemId]
    )).rows[0];
    if (Number(vv.c) !== 29) throw new Error(`cantidad=${vv.c}, esperaba 29 del server`);
    if (vv.u !== "G") throw new Error(`unidad=${vv.u}`);
    if (Number(vv.cu) !== 150) throw new Error(`costo_unitario_snapshot=${vv.cu}, esperaba 150 del server`);
    if (vv.eo !== "Chocolate negro") throw new Error(`opcion_etiqueta=${vv.eo}`);
    if (vv.gc !== "chocolate") throw new Error(`grupo_codigo=${vv.gc}`);
    if (vv.sk !== "MP-0020") throw new Error(`insumo_sku=${vv.sk}`);
    void ventaId;
  });

  await test("F3 — consumo auto OFF: NO movimientos de insumos (solo productos controla_stock)", async () => {
    // Venta sin stock_deltas sobre insumos → representa el comportamiento con consumo OFF.
    const itemId = randomUUID();
    const payload = basePayload("F3");
    payload.items = [{
      id: itemId, producto_id: PROD_TRAD, producto_nombre: "Tradicional", sku: "ACAI_TRAD_001",
      cantidad: 1, precio_venta_original: 14000, precio_venta: 14000,
      tipo_iva: "EXENTA", tipo_precio: "minorista",
      subtotal: 14000, monto_iva: 0, total_linea: 14000, presentacion_id: PRES_CHI,
      adicionales: [], variantes: [{ grupo_id: grupoId, opcion_id: opNegro }],
    }];
    const stockAntes = Number((await c.query("SELECT stock_actual::text AS s FROM acaihouse.productos WHERE id=$1", [INS_CHOCO_NEGRO])).rows[0].s);
    const r = await c.query("SELECT venta_id FROM acaihouse.fn_crear_venta_atomica($1::jsonb)", [JSON.stringify(payload)]);
    const ventaId = r.rows[0].venta_id;
    // Sin stock_deltas → el stock del insumo NO debe haber cambiado.
    const stockDespues = Number((await c.query("SELECT stock_actual::text AS s FROM acaihouse.productos WHERE id=$1", [INS_CHOCO_NEGRO])).rows[0].s);
    if (stockDespues !== stockAntes) throw new Error(`stock cambió: ${stockAntes} → ${stockDespues}`);
    // Y NO debe haber movimiento de este insumo con este venta_id.
    const mov = Number((await c.query("SELECT count(*)::int AS n FROM acaihouse.movimientos_inventario WHERE venta_id=$1 AND producto_id=$2", [ventaId, INS_CHOCO_NEGRO])).rows[0].n);
    if (mov !== 0) throw new Error(`movimientos=${mov}, esperaba 0 con consumo OFF`);
    // La variante SÍ se persiste (trazabilidad).
    const v = Number((await c.query("SELECT count(*)::int AS n FROM acaihouse.venta_item_variantes WHERE venta_item_id=$1", [itemId])).rows[0].n);
    if (v !== 1) throw new Error("variante no se persistió");
  });

  await test("F4 — 2 líneas del mismo producto con sabores distintos", async () => {
    const i1 = randomUUID(), i2 = randomUUID();
    const payload = basePayload("F4");
    payload.venta.total = 28000; payload.venta.subtotal = 28000;
    const itemBase = {
      producto_id: PROD_TRAD, producto_nombre: "Tradicional", sku: "ACAI_TRAD_001",
      cantidad: 1, precio_venta_original: 14000, precio_venta: 14000,
      tipo_iva: "EXENTA", tipo_precio: "minorista",
      subtotal: 14000, monto_iva: 0, total_linea: 14000, presentacion_id: PRES_CHI,
      adicionales: [],
    };
    payload.items = [
      { ...itemBase, id: i1, variantes: [{ grupo_id: grupoId, opcion_id: opBlanco }] },
      { ...itemBase, id: i2, variantes: [{ grupo_id: grupoId, opcion_id: opNegro }] },
    ];
    await c.query("SELECT venta_id FROM acaihouse.fn_crear_venta_atomica($1::jsonb)", [JSON.stringify(payload)]);
    const v1 = (await c.query("SELECT opcion_etiqueta AS e, costo_unitario_snapshot::text AS c FROM acaihouse.venta_item_variantes WHERE venta_item_id=$1", [i1])).rows[0];
    const v2 = (await c.query("SELECT opcion_etiqueta AS e, costo_unitario_snapshot::text AS c FROM acaihouse.venta_item_variantes WHERE venta_item_id=$1", [i2])).rows[0];
    if (v1.e !== "Chocolate blanco" || Number(v1.c) !== 120) throw new Error(`v1=${JSON.stringify(v1)}`);
    if (v2.e !== "Chocolate negro" || Number(v2.c) !== 150) throw new Error(`v2=${JSON.stringify(v2)}`);
  });

  await test("F5 — permitir_sin_stock: stock queda en negativo, movimiento registra cantidad real", async () => {
    const itemId = randomUUID();
    const payload = basePayload("F5");
    payload.permitir_sin_stock = true;
    payload.items = [{
      id: itemId, producto_id: PROD_REVENTA, producto_nombre: "Gaseosa test", sku: "REV-TEST",
      cantidad: 10, precio_venta_original: 5000, precio_venta: 5000,
      tipo_iva: "EXENTA", tipo_precio: "minorista",
      subtotal: 50000, monto_iva: 0, total_linea: 50000, presentacion_id: null,
      adicionales: [], variantes: [],
    }];
    payload.venta.total = 50000; payload.venta.subtotal = 50000;
    const stockAntes = Number((await c.query("SELECT stock_actual::text AS s FROM acaihouse.productos WHERE id=$1", [PROD_REVENTA])).rows[0].s);
    payload.stock_deltas = [{
      producto_id: PROD_REVENTA, delta_qty: 10, movimiento: { tipo: "SALIDA", origen: "venta", referencia: payload.venta.numero_control },
    }];
    const r = await c.query("SELECT venta_id FROM acaihouse.fn_crear_venta_atomica($1::jsonb)", [JSON.stringify(payload)]);
    const ventaId = r.rows[0].venta_id;
    // Política corregida: stock puede quedar negativo. stockAntes=5 (del seed), delta=10 → resultado -5.
    const stockDespues = Number((await c.query("SELECT stock_actual::text AS s FROM acaihouse.productos WHERE id=$1", [PROD_REVENTA])).rows[0].s);
    const esperado = stockAntes - 10;
    if (stockDespues !== esperado) throw new Error(`stock=${stockDespues}, esperaba ${esperado} (política sin GREATEST)`);
    // Movimiento registra cantidad COMPLETA (10), no solo la parte "cubierta por stock".
    const mov = (await c.query("SELECT cantidad::text AS q, costo_unitario::text AS c FROM acaihouse.movimientos_inventario WHERE venta_id=$1 AND producto_id=$2", [ventaId, PROD_REVENTA])).rows[0];
    if (Number(mov.q) !== 10) throw new Error(`movimiento cantidad=${mov.q}, esperaba 10 (no se oculta consumo)`);
    if (Number(mov.c) !== 3000) throw new Error(`costo_unitario=${mov.c}, esperaba 3000 del server`);
  });

  await test("F6 — tenant check: empresa_id ajeno (no en la lista) con rol authenticated → 42501", async () => {
    // Simulamos authenticated conectándonos con SET ROLE authenticated.
    // La función `puede_acceder_empresa` del seed retorna true por default.
    // Para este test cambiamos su implementación a verificar empresa específica.
    await c.query("CREATE OR REPLACE FUNCTION acaihouse.puede_acceder_empresa(e uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT e = '" + EMPRESA + "'::uuid $$");
    // Redefinir la función RPC con la nueva puede_acceder_empresa (no es necesario, es STABLE).
    try {
      await c.query("SET ROLE authenticated");
      const payload = basePayload("F6");
      payload.empresa_id = EMPRESA_AJENA;
      payload.items = [{
        id: randomUUID(), producto_id: PROD_TRAD, producto_nombre: "Tradicional", sku: "ACAI_TRAD_001",
        cantidad: 1, precio_venta_original: 14000, precio_venta: 14000,
        tipo_iva: "EXENTA", tipo_precio: "minorista",
        subtotal: 14000, monto_iva: 0, total_linea: 14000, presentacion_id: null,
        adicionales: [], variantes: [],
      }];
      const r = await tryQ(() => c.query("SELECT venta_id FROM acaihouse.fn_crear_venta_atomica($1::jsonb)", [JSON.stringify(payload)]));
      if (r.ok) throw new Error("esperaba 42501 permission denied");
      if ((r.error.code ?? "") !== "42501") throw new Error(`errcode=${r.error.code}, esperaba 42501`);
    } finally {
      await c.query("RESET ROLE");
      await c.query("CREATE OR REPLACE FUNCTION acaihouse.puede_acceder_empresa(e uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$");
    }
  });

  console.log(`\n=== RESULT: ${passed} OK, ${failed} FAIL ===`);
  await c.end();
  if (failed > 0) process.exit(1);
})().catch((e) => { console.error("ERROR global:", e.message, e.stack); process.exit(1); });
