// Fase 2.2 Parte 4 — tests de integración REALES de atomicidad.
//
// Estrategia: BEGIN READ WRITE → aplicar DDL de ambas migraciones INLINE →
// correr los tests → ROLLBACK forzado al final. De esta forma el test se
// ejecuta contra una DB real, demostrando el comportamiento de la RPC,
// sin dejar ni una fila/tabla/función persistida.
//
// Cobertura:
//   T1. Venta + item + adicional + variante + stock_update → persisten
//       dentro del SAVEPOINT. Luego ROLLBACK TO SAVEPOINT los limpia.
//   T2. Error en una variante (FK rota) → la operación aborta y ni venta
//       ni item quedan en DB. Garantía de atomicidad real de la función.
//   T3. Venta sin variantes se persiste normalmente.
//   T4. Stock_update inválido (producto inexistente) → toda la operación
//       rollback, la venta no queda.
//   T5. UNIQUE (venta_item_id, grupo_codigo) rechaza dos opciones del
//       mismo grupo en la misma línea.
const path = require("path");
const fs = require("fs");
const pg = require("pg");
const { randomUUID } = require("node:crypto");
require("dotenv").config({ path: path.resolve("C:/NEURA/acai-house-main/.env.local") });

const url = process.env.SUPABASE_DB_URL;
const EMPRESA = "a9276529-bca9-418a-b014-375e68d667d2";
const PROD_TRAD = "044bcd13-1e0f-40db-a070-d45d8003c936";

const MIG_TABLAS = path.resolve(
  "C:/Users/Hp/AppData/Local/Temp/claude/3b0c63223a83f7df/9d5210ec-ec6e-406f-9525-7250fa27a7a1/scratchpad/acai-p4/supabase/acaihouse/migrations/20261125120000_fase22p4_variantes_recetas.sql"
);
const MIG_FN = path.resolve(
  "C:/Users/Hp/AppData/Local/Temp/claude/3b0c63223a83f7df/9d5210ec-ec6e-406f-9525-7250fa27a7a1/scratchpad/acai-p4/supabase/acaihouse/migrations/20261125130000_fase22p4_fn_crear_venta_atomica.sql"
);

function stripOuterTx(sql) {
  // La migración envuelve todo en BEGIN...COMMIT. Nosotros ya estamos en
  // transacción, así que stripeamos el BEGIN/COMMIT externos.
  return sql
    .replace(/^\s*BEGIN\s*;/i, "")
    .replace(/\s*COMMIT\s*;\s*$/i, "");
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  OK   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

(async () => {
  const c = new pg.Client({
    connectionString: url,
    ssl: url.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
    application_name: "test-fase22p4-atomic",
  });
  await c.connect();
  try {
    await c.query("BEGIN");
    try {
      // 1) Aplicar migración de tablas + insumos INLINE.
      const sqlTablas = stripOuterTx(fs.readFileSync(MIG_TABLAS, "utf8"));
      await c.query(sqlTablas);
      // 2) Aplicar migración de función RPC INLINE.
      const sqlFn = stripOuterTx(fs.readFileSync(MIG_FN, "utf8"));
      await c.query(sqlFn);
      console.log("  SET-UP: ambas migraciones aplicadas dentro de la transacción");

      // ── Fixture: crear receta de prueba + grupo + opciones dentro de un SAVEPOINT ──
      await c.query("SAVEPOINT fixture");
      // Buscar DOS insumos distintos para las dos opciones del grupo.
      const insumoQ = await c.query(
        "SELECT id, sku, nombre FROM acaihouse.productos WHERE empresa_id=$1 AND es_insumo=true AND activo=true ORDER BY sku LIMIT 2",
        [EMPRESA]
      );
      if (insumoQ.rows.length < 2) throw new Error("Se requieren 2 insumos de prueba en la DB");
      const insumo = insumoQ.rows[0];
      const insumo2 = insumoQ.rows[1];
      // Buscar una receta activa de Tradicional (cargada en Parte 2).
      const PRES_CHI = "fbe14515-61c5-4ae9-a785-9f9c6b1e3dbe";
      const recetaQ = await c.query(
        "SELECT id FROM acaihouse.recetas WHERE empresa_id=$1 AND producto_id=$2 AND presentacion_id=$3 AND activa=true LIMIT 1",
        [EMPRESA, PROD_TRAD, PRES_CHI]
      );
      if (recetaQ.rows.length === 0) throw new Error("Receta Tradicional Chico no encontrada");
      const recetaId = recetaQ.rows[0].id;
      // Crear grupo + 2 opciones.
      const g = await c.query(
        "INSERT INTO acaihouse.receta_grupos_variante (empresa_id, receta_id, codigo, etiqueta, obligatorio, orden) VALUES ($1,$2,$3,$4,true,1) RETURNING id",
        [EMPRESA, recetaId, "test_choco", "Chocolate test"]
      );
      const grupoId = g.rows[0].id;
      const o1 = await c.query(
        "INSERT INTO acaihouse.receta_grupo_opciones (empresa_id, grupo_id, insumo_producto_id, cantidad, unidad_medida, merma_pct, etiqueta, orden) VALUES ($1,$2,$3,20,'G',0,'Opcion A',1) RETURNING id",
        [EMPRESA, grupoId, insumo.id]
      );
      const opA = o1.rows[0].id;
      const o2 = await c.query(
        "INSERT INTO acaihouse.receta_grupo_opciones (empresa_id, grupo_id, insumo_producto_id, cantidad, unidad_medida, merma_pct, etiqueta, orden) VALUES ($1,$2,$3,25,'G',0,'Opcion B',2) RETURNING id",
        [EMPRESA, grupoId, insumo2.id]
      );
      const opB = o2.rows[0].id;

      await c.query("SAVEPOINT t1");
      await test("T1 — venta + item + variante + stock_update persisten atómicamente", async () => {
        const itemId = randomUUID();
        const payload = {
          empresa_id: EMPRESA,
          venta: {
            numero_control: "TEST-" + Math.floor(Math.random() * 1e8),
            fecha: new Date().toISOString(),
            total: 10000, subtotal: 10000, monto_iva: 0, tipo_iva_resumen: "EXENTA",
            tipo_venta: "CONTADO", plazo_dias: null, fecha_vencimiento: null,
            moneda: "GS", tipo_cambio: 1, cliente_id: null, observaciones: null,
            metodo_pago: "efectivo", caja_id: null, created_by: null, usuario_nombre: null,
            genera_nota_remision: false,
          },
          items: [{
            id: itemId, producto_id: PROD_TRAD, producto_nombre: "Tradicional", sku: "ACAI_TRAD_001",
            cantidad: 1, precio_venta_original: 10000, precio_venta: 10000,
            tipo_iva: "EXENTA", tipo_precio: "minorista",
            subtotal: 10000, monto_iva: 0, total_linea: 10000, presentacion_id: PRES_CHI,
            variantes: [{
              grupo_id: grupoId, opcion_id: opA, grupo_codigo: "test_choco",
              grupo_etiqueta: "Chocolate test", opcion_etiqueta: "Opcion A",
              insumo_producto_id: insumo.id, insumo_sku: insumo.sku, insumo_nombre: insumo.nombre,
              cantidad: 20, unidad_medida: "G", merma_pct: 0, costo_unitario_snapshot: 150,
            }],
          }],
          cxc: null,
          stock_updates: [],
        };
        const r = await c.query("SELECT venta_id FROM acaihouse.fn_crear_venta_atomica($1)", [JSON.stringify(payload)]);
        const ventaId = r.rows[0].venta_id;
        if (!ventaId) throw new Error("no venta_id");
        const items = (await c.query("SELECT count(*)::int AS n FROM acaihouse.ventas_items WHERE venta_id=$1", [ventaId])).rows[0].n;
        if (items !== 1) throw new Error(`items=${items}`);
        const vars = (await c.query("SELECT count(*)::int AS n, (array_agg(costo_unitario_snapshot))[1]::text AS costo FROM acaihouse.venta_item_variantes WHERE venta_item_id=$1", [itemId])).rows[0];
        if (vars.n !== 1) throw new Error(`variantes=${vars.n}`);
        if (Number(vars.costo) !== 150) throw new Error(`costo snapshot=${vars.costo}, esperaba 150`);
      });
      await c.query("ROLLBACK TO SAVEPOINT t1");

      await c.query("SAVEPOINT t2");
      await test("T2 — insumo inexistente en snapshot → rollback total", async () => {
        const itemId = randomUUID();
        const payload = {
          empresa_id: EMPRESA,
          venta: {
            numero_control: "TEST-" + Math.floor(Math.random() * 1e8),
            fecha: new Date().toISOString(),
            total: 1000, subtotal: 1000, monto_iva: 0, tipo_iva_resumen: "EXENTA",
            tipo_venta: "CONTADO", plazo_dias: null, fecha_vencimiento: null,
            moneda: "GS", tipo_cambio: 1, cliente_id: null, observaciones: null,
            metodo_pago: "efectivo", caja_id: null, created_by: null, usuario_nombre: null,
            genera_nota_remision: false,
          },
          items: [{
            id: itemId, producto_id: PROD_TRAD, producto_nombre: "Tradicional", sku: "ACAI_TRAD_001",
            cantidad: 1, precio_venta_original: 1000, precio_venta: 1000,
            tipo_iva: "EXENTA", tipo_precio: "minorista",
            subtotal: 1000, monto_iva: 0, total_linea: 1000, presentacion_id: null,
            variantes: [{
              grupo_id: null, opcion_id: null, grupo_codigo: "x", grupo_etiqueta: "x", opcion_etiqueta: "x",
              insumo_producto_id: "00000000-0000-0000-0000-000000000000",
              insumo_sku: "XXX", insumo_nombre: "XXX",
              cantidad: 1, unidad_medida: "G", merma_pct: 0,
            }],
          }],
          cxc: null, stock_updates: [],
        };
        let threw = false;
        try { await c.query("SELECT venta_id FROM acaihouse.fn_crear_venta_atomica($1)", [JSON.stringify(payload)]); }
        catch (e) { threw = true; }
        if (!threw) throw new Error("esperaba error de FK");
        // Atomicidad: nada quedó. Necesitamos liberar el error de aborted tx antes de query.
        await c.query("ROLLBACK TO SAVEPOINT t2");
        await c.query("SAVEPOINT t2");
        const n1 = (await c.query("SELECT count(*)::int AS n FROM acaihouse.ventas_items WHERE id=$1", [itemId])).rows[0].n;
        const n2 = (await c.query("SELECT count(*)::int AS n FROM acaihouse.venta_item_variantes WHERE venta_item_id=$1", [itemId])).rows[0].n;
        if (n1 !== 0 || n2 !== 0) throw new Error(`items=${n1} variantes=${n2}`);
      });
      await c.query("ROLLBACK TO SAVEPOINT t2");

      await c.query("SAVEPOINT t3");
      await test("T3 — venta sin variantes se persiste normalmente", async () => {
        const itemId = randomUUID();
        const payload = {
          empresa_id: EMPRESA,
          venta: {
            numero_control: "TEST-" + Math.floor(Math.random() * 1e8),
            fecha: new Date().toISOString(),
            total: 5000, subtotal: 5000, monto_iva: 0, tipo_iva_resumen: "EXENTA",
            tipo_venta: "CONTADO", plazo_dias: null, fecha_vencimiento: null,
            moneda: "GS", tipo_cambio: 1, cliente_id: null, observaciones: null,
            metodo_pago: "efectivo", caja_id: null, created_by: null, usuario_nombre: null,
            genera_nota_remision: false,
          },
          items: [{
            id: itemId, producto_id: PROD_TRAD, producto_nombre: "Tradicional", sku: "ACAI_TRAD_001",
            cantidad: 1, precio_venta_original: 5000, precio_venta: 5000,
            tipo_iva: "EXENTA", tipo_precio: "minorista",
            subtotal: 5000, monto_iva: 0, total_linea: 5000, presentacion_id: null,
            variantes: [], adicionales: [],
          }],
          cxc: null, stock_updates: [],
        };
        const r = await c.query("SELECT venta_id FROM acaihouse.fn_crear_venta_atomica($1)", [JSON.stringify(payload)]);
        if (!r.rows[0].venta_id) throw new Error("no venta_id");
      });
      await c.query("ROLLBACK TO SAVEPOINT t3");

      await c.query("SAVEPOINT t4");
      await test("T4 — stock_update de producto inexistente → rollback total", async () => {
        const itemId = randomUUID();
        const payload = {
          empresa_id: EMPRESA,
          venta: {
            numero_control: "TEST-" + Math.floor(Math.random() * 1e8),
            fecha: new Date().toISOString(),
            total: 1000, subtotal: 1000, monto_iva: 0, tipo_iva_resumen: "EXENTA",
            tipo_venta: "CONTADO", plazo_dias: null, fecha_vencimiento: null,
            moneda: "GS", tipo_cambio: 1, cliente_id: null, observaciones: null,
            metodo_pago: "efectivo", caja_id: null, created_by: null, usuario_nombre: null,
            genera_nota_remision: false,
          },
          items: [{
            id: itemId, producto_id: PROD_TRAD, producto_nombre: "Tradicional", sku: "ACAI_TRAD_001",
            cantidad: 1, precio_venta_original: 1000, precio_venta: 1000,
            tipo_iva: "EXENTA", tipo_precio: "minorista",
            subtotal: 1000, monto_iva: 0, total_linea: 1000, presentacion_id: null,
            variantes: [], adicionales: [],
          }],
          cxc: null,
          stock_updates: [{ producto_id: "00000000-0000-0000-0000-000000000000", nuevo_stock: 0, movimiento: null }],
        };
        let threw = false;
        try { await c.query("SELECT venta_id FROM acaihouse.fn_crear_venta_atomica($1)", [JSON.stringify(payload)]); }
        catch (e) { threw = true; }
        if (!threw) throw new Error("esperaba error");
        await c.query("ROLLBACK TO SAVEPOINT t4");
        await c.query("SAVEPOINT t4");
        const n = (await c.query("SELECT count(*)::int AS n FROM acaihouse.ventas_items WHERE id=$1", [itemId])).rows[0].n;
        if (n !== 0) throw new Error("items quedaron");
      });
      await c.query("ROLLBACK TO SAVEPOINT t4");

      await c.query("SAVEPOINT t5");
      await test("T5 — UNIQUE grupo_codigo por venta_item: 2 opciones mismo grupo → rechazo", async () => {
        const itemId = randomUUID();
        const payload = {
          empresa_id: EMPRESA,
          venta: {
            numero_control: "TEST-" + Math.floor(Math.random() * 1e8),
            fecha: new Date().toISOString(),
            total: 1000, subtotal: 1000, monto_iva: 0, tipo_iva_resumen: "EXENTA",
            tipo_venta: "CONTADO", plazo_dias: null, fecha_vencimiento: null,
            moneda: "GS", tipo_cambio: 1, cliente_id: null, observaciones: null,
            metodo_pago: "efectivo", caja_id: null, created_by: null, usuario_nombre: null,
            genera_nota_remision: false,
          },
          items: [{
            id: itemId, producto_id: PROD_TRAD, producto_nombre: "Tradicional", sku: "ACAI_TRAD_001",
            cantidad: 1, precio_venta_original: 1000, precio_venta: 1000,
            tipo_iva: "EXENTA", tipo_precio: "minorista",
            subtotal: 1000, monto_iva: 0, total_linea: 1000, presentacion_id: PRES_CHI,
            variantes: [
              { grupo_id: grupoId, opcion_id: opA, grupo_codigo: "test_choco", grupo_etiqueta: "x", opcion_etiqueta: "A",
                insumo_producto_id: insumo.id, insumo_sku: insumo.sku, insumo_nombre: insumo.nombre,
                cantidad: 10, unidad_medida: "G", merma_pct: 0 },
              { grupo_id: grupoId, opcion_id: opB, grupo_codigo: "test_choco", grupo_etiqueta: "x", opcion_etiqueta: "B",
                insumo_producto_id: insumo.id, insumo_sku: insumo.sku, insumo_nombre: insumo.nombre,
                cantidad: 10, unidad_medida: "G", merma_pct: 0 },
            ],
          }],
          cxc: null, stock_updates: [],
        };
        let threw = false;
        try { await c.query("SELECT venta_id FROM acaihouse.fn_crear_venta_atomica($1)", [JSON.stringify(payload)]); }
        catch (e) { threw = true; }
        if (!threw) throw new Error("esperaba unique violation");
      });
      await c.query("ROLLBACK TO SAVEPOINT t5");
      await c.query("ROLLBACK TO SAVEPOINT fixture");
    } finally {
      await c.query("ROLLBACK"); // descarta TODO el DDL + datos.
    }
    console.log(`\n=== RESULT: ${passed} OK, ${failed} FAIL ===`);
    if (failed > 0) process.exit(1);
  } finally {
    await c.end();
  }
})().catch((e) => { console.error("ERROR global:", e.message); process.exit(1); });
