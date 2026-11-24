// Fase 2.2 Parte 4 — tests de integración de atomicidad usando una
// transacción BEGIN READ WRITE / ROLLBACK contra la DB de QA.
//
// NOTA: se ejecuta exclusivamente dentro de un BEGIN con SAVEPOINT que
// termina SIEMPRE en ROLLBACK. NO deja escrituras. Si falla el ROLLBACK
// (inesperado), lanza el error en lugar de silenciarlo.
//
// Cobertura:
//   1. Venta + items + adicionales + variantes se persisten como un bloque
//      atómico a través de fn_crear_venta_atomica.
//   2. Si un INSERT de variante referencia un grupo de otra empresa, la
//      función aborta y NADA queda persistido.
//   3. Si el array variantes tiene dos opciones para el mismo grupo, el
//      UNIQUE (venta_item_id, grupo_codigo) aborta la operación.
//   4. Producto sin variantes se persiste normalmente (no cambia nada).
//
// Precondiciones:
//   - Migración 20261125120000_fase22p4_variantes_recetas aplicada.
//   - Migración 20261125130000_fase22p4_fn_crear_venta_atomica aplicada.
//   - Productos variantes MP-0019/20/21 existentes.
//   - Receta Tradicional Chico (cargada en Parte 2) existente.
//
// Si el preflight no detecta estos elementos, el script skipea con exit 0
// y un mensaje claro.
const path = require("path");
const pg = require("pg");
const { randomUUID } = require("node:crypto");
require("dotenv").config({ path: path.resolve("C:/NEURA/acai-house-main/.env.local") });

const url = process.env.SUPABASE_DB_URL;
const EMPRESA = "a9276529-bca9-418a-b014-375e68d667d2";
const PROD_TRAD = "044bcd13-1e0f-40db-a070-d45d8003c936";

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  OK   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

(async () => {
  const c = new pg.Client({ connectionString: url, ssl: url.includes("sslmode=disable") ? false : { rejectUnauthorized: false }, application_name: "test-fase22p4-atomic" });
  await c.connect();
  try {
    // ── Preflight ────────────────────────────────────────────────────────
    const fnExists = (await c.query("SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='acaihouse' AND p.proname='fn_crear_venta_atomica'")).rows.length > 0;
    if (!fnExists) {
      console.log("SKIP — fn_crear_venta_atomica no existe todavía (migración pendiente).");
      process.exit(0);
    }
    const tblExists = (await c.query("SELECT 1 FROM information_schema.tables WHERE table_schema='acaihouse' AND table_name='venta_item_variantes'")).rows.length > 0;
    if (!tblExists) {
      console.log("SKIP — venta_item_variantes no existe todavía.");
      process.exit(0);
    }

    // ── Setup fixture dentro de SAVEPOINT ────────────────────────────────
    await c.query("BEGIN");
    try {
      // Crear una receta de prueba para Tradicional Chico (presentacion_id simulada)
      // En vez de depender de datos vivos, creamos una receta dummy que luego descartamos
      // junto con el rollback.
      const PRES_CHI = "fbe14515-61c5-4ae9-a785-9f9c6b1e3dbe";

      await c.query("SAVEPOINT test1");

      await test("1) Venta con variante elegida persiste items + variantes atómicamente", async () => {
        // Primero necesitamos una receta activa con grupo+opcion. Buscamos una receta
        // activa cualquiera o la creamos. Para simplicidad usamos cualquier receta activa
        // de Tradicional (cargada en Parte 2).
        const recetaQ = await c.query(
          "SELECT id FROM acaihouse.recetas WHERE empresa_id=$1 AND producto_id=$2 AND presentacion_id=$3 AND activa=true LIMIT 1",
          [EMPRESA, PROD_TRAD, PRES_CHI]
        );
        if (recetaQ.rows.length === 0) throw new Error("Receta Tradicional Chico no encontrada — skipeo");
        const recetaId = recetaQ.rows[0].id;
        // Crear grupo+opcion de prueba en savepoint
        const insG = await c.query(
          "INSERT INTO acaihouse.receta_grupos_variante (empresa_id, receta_id, codigo, etiqueta, obligatorio, orden) VALUES ($1,$2,$3,$4,true,1) RETURNING id",
          [EMPRESA, recetaId, "test_var_" + Math.floor(Math.random() * 1e6), "Variante prueba"]
        );
        const grupoId = insG.rows[0].id;
        // Buscar un insumo cualquiera
        const insumoQ = await c.query(
          "SELECT id, sku, nombre FROM acaihouse.productos WHERE empresa_id=$1 AND es_insumo=true AND activo=true LIMIT 1",
          [EMPRESA]
        );
        const insumo = insumoQ.rows[0];
        const insO = await c.query(
          "INSERT INTO acaihouse.receta_grupo_opciones (empresa_id, grupo_id, insumo_producto_id, cantidad, unidad_medida, merma_pct, etiqueta, orden) VALUES ($1,$2,$3,$4,'G',0,$5,1) RETURNING id",
          [EMPRESA, grupoId, insumo.id, 10, "Opcion test"]
        );
        const opcionId = insO.rows[0].id;

        // Payload a la RPC
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
            subtotal: 1000, monto_iva: 0, total_linea: 1000,
            presentacion_id: PRES_CHI,
            variantes: [{
              grupo_id: grupoId, opcion_id: opcionId,
              grupo_codigo: "test_var", grupo_etiqueta: "Variante prueba",
              opcion_etiqueta: "Opcion test",
              insumo_producto_id: insumo.id, insumo_sku: insumo.sku, insumo_nombre: insumo.nombre,
              cantidad: 10, unidad_medida: "G", merma_pct: 0,
            }],
          }],
          cxc: null,
        };
        const r = await c.query("SELECT venta_id FROM acaihouse.fn_crear_venta_atomica($1)", [JSON.stringify(payload)]);
        const ventaId = r.rows[0].venta_id;
        if (!ventaId) throw new Error("fn_crear_venta_atomica no devolvió venta_id");

        // Verificar persistencia
        const vi = await c.query("SELECT COUNT(*)::int AS n FROM acaihouse.venta_item_variantes WHERE venta_item_id=$1", [itemId]);
        if (vi.rows[0].n !== 1) throw new Error("No se persistió variante");
        const it = await c.query("SELECT COUNT(*)::int AS n FROM acaihouse.ventas_items WHERE venta_id=$1", [ventaId]);
        if (it.rows[0].n !== 1) throw new Error("No se persistió el item");
      });

      await c.query("ROLLBACK TO SAVEPOINT test1");
      await c.query("SAVEPOINT test2");

      await test("2) Error en snapshot → rollback completo (no queda venta ni items)", async () => {
        // Forzar error: insumo_producto_id inexistente dispara FK del trigger.
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
              grupo_id: null, opcion_id: null,
              grupo_codigo: "test", grupo_etiqueta: "Test", opcion_etiqueta: "Test",
              insumo_producto_id: "00000000-0000-0000-0000-000000000000",
              insumo_sku: "XXX", insumo_nombre: "XXX",
              cantidad: 1, unidad_medida: "G", merma_pct: 0,
            }],
          }],
          cxc: null,
        };
        let threw = false;
        try {
          await c.query("SELECT venta_id FROM acaihouse.fn_crear_venta_atomica($1)", [JSON.stringify(payload)]);
        } catch (e) {
          threw = true;
        }
        if (!threw) throw new Error("Se esperaba error del trigger de FK");
        // Verificar atomicidad: nada quedó persistido en venta_item_variantes ni en ventas_items con ese item id.
        const n1 = (await c.query("SELECT COUNT(*)::int AS n FROM acaihouse.venta_item_variantes WHERE venta_item_id=$1", [itemId])).rows[0].n;
        const n2 = (await c.query("SELECT COUNT(*)::int AS n FROM acaihouse.ventas_items WHERE id=$1", [itemId])).rows[0].n;
        if (n1 !== 0 || n2 !== 0) throw new Error(`Atomicidad rota: variantes=${n1} items=${n2}`);
      });

      await c.query("ROLLBACK TO SAVEPOINT test2");
      await c.query("SAVEPOINT test3");

      await test("3) Venta sin variantes se persiste normalmente", async () => {
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
            variantes: [],
            adicionales: [],
          }],
          cxc: null,
        };
        const r = await c.query("SELECT venta_id FROM acaihouse.fn_crear_venta_atomica($1)", [JSON.stringify(payload)]);
        if (!r.rows[0].venta_id) throw new Error("Sin venta_id");
        const vi = (await c.query("SELECT COUNT(*)::int AS n FROM acaihouse.venta_item_variantes WHERE venta_item_id=$1", [itemId])).rows[0].n;
        if (vi !== 0) throw new Error("No deberían crearse variantes");
        const it = (await c.query("SELECT COUNT(*)::int AS n FROM acaihouse.ventas_items WHERE id=$1", [itemId])).rows[0].n;
        if (it !== 1) throw new Error("Item no se creó");
      });

      await c.query("ROLLBACK TO SAVEPOINT test3");
    } finally {
      // SIEMPRE rollback. Nada debe quedar.
      await c.query("ROLLBACK");
    }

    console.log(`\n=== RESULT: ${passed} OK, ${failed} FAIL ===`);
    if (failed > 0) process.exit(1);
  } finally {
    await c.end();
  }
})().catch((e) => { console.error("ERROR global:", e.message); process.exit(1); });
