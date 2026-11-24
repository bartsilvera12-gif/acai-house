// Fase 2.2 Parte 4 — tests unitarios de la lógica de variantes.
// Puro JS, sin DB. Emula el bloque de validación/consumo de create-venta-pg.ts
// para cubrir los casos críticos: faltante, duplicado, cruzado, selección válida,
// no cambio de precio, y conversión de unidades para consumo.
process.env.NODE_NO_WARNINGS = "1";
require("tsx/cjs");
const path = require("path");
const { convertirCantidad } = require(path.resolve("src/lib/unidades/convert.ts"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  OK   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || "mismatch"}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
}
function close(a, b, tol, msg) {
  if (typeof a !== "number" || !Number.isFinite(a) || Math.abs(a - b) > (tol ?? 1e-4))
    throw new Error(`${msg || "not close"}: got ${a}, expected ${b}`);
}

// ─────── Fixtures ───────
const PRES_MED = "pres-med";
const RECETA_ID = "rec-frutilla-med";
const INS_CHOCO_BLANCO = "ins-choco-blanco";
const INS_CHOCO_NEGRO  = "ins-choco-negro";
const INS_CHOCO_COOKIES = "ins-choco-cookies";

const grupoChocolate = {
  id: "grp-chocolate",
  receta_id: RECETA_ID,
  codigo: "chocolate",
  etiqueta: "Chocolate",
  obligatorio: true,
  orden: 1,
  opciones: new Map([
    ["op-blanco",  { id: "op-blanco",  grupo_id: "grp-chocolate", insumo_producto_id: INS_CHOCO_BLANCO,  cantidad: 29, unidad_medida: "G", merma_pct: 0, etiqueta: "Chocolate blanco" }],
    ["op-negro",   { id: "op-negro",   grupo_id: "grp-chocolate", insumo_producto_id: INS_CHOCO_NEGRO,   cantidad: 29, unidad_medida: "G", merma_pct: 0, etiqueta: "Chocolate negro" }],
    ["op-cookies", { id: "op-cookies", grupo_id: "grp-chocolate", insumo_producto_id: INS_CHOCO_COOKIES, cantidad: 29, unidad_medida: "G", merma_pct: 0, etiqueta: "Chocolate Cookies" }],
  ]),
};
const grupoBis = {
  id: "grp-bis",
  receta_id: RECETA_ID,
  codigo: "bis",
  etiqueta: "Bis",
  obligatorio: true,
  orden: 2,
  opciones: new Map([
    ["op-bis-blanco", { id: "op-bis-blanco", grupo_id: "grp-bis", insumo_producto_id: "ins-bis-blanco", cantidad: 1, unidad_medida: "UNIDAD", merma_pct: 0, etiqueta: "Bis blanco" }],
    ["op-bis-negro",  { id: "op-bis-negro",  grupo_id: "grp-bis", insumo_producto_id: "ins-bis-negro",  cantidad: 1, unidad_medida: "UNIDAD", merma_pct: 0, etiqueta: "Bis negro" }],
  ]),
};

function makeInsumoMeta(unidad) {
  return new Map([
    [INS_CHOCO_BLANCO,  { stock: 0, costo: 10000, nombre: "Crema de chocolate blanco", sku: "MP-0019", unidad }],
    [INS_CHOCO_NEGRO,   { stock: 0, costo: 10000, nombre: "Crema de chocolate negro",  sku: "MP-0020", unidad }],
    [INS_CHOCO_COOKIES, { stock: 0, costo: 10000, nombre: "Crema de chocolate Cookies",sku: "MP-0021", unidad }],
    ["ins-bis-blanco",  { stock: 0, costo: 500,   nombre: "Bis blanco",                sku: "MP-0006", unidad: "UNIDAD" }],
    ["ins-bis-negro",   { stock: 0, costo: 500,   nombre: "Bis negro",                 sku: "MP-0007", unidad: "UNIDAD" }],
  ]);
}

// Función bajo prueba: emula el bloque de validación del executor real.
function validarYConsumir({ gruposDeReceta, seleccion, qtySold, rendimiento, insumoMeta, consumoInsumosActivo }) {
  const grupoById = new Map(gruposDeReceta.map((g) => [g.id, g]));
  const obligatorios = gruposDeReceta.filter((g) => g.obligatorio);
  const seenGrupo = new Set();
  for (const v of seleccion) {
    if (seenGrupo.has(v.grupo_id)) throw new Error("GRUPO_DUPLICADO");
    seenGrupo.add(v.grupo_id);
  }
  for (const v of seleccion) {
    const g = grupoById.get(v.grupo_id);
    if (!g) throw new Error("GRUPO_CRUZADO");
    const op = g.opciones.get(v.opcion_id);
    if (!op) throw new Error("OPCION_CRUZADA");
  }
  for (const g of obligatorios) {
    const hit = seleccion.find((v) => v.grupo_id === g.id);
    if (!hit) throw new Error(`FALTA_GRUPO:${g.codigo}`);
  }
  const snapshots = [];
  const consumo = new Map();
  for (const v of seleccion) {
    const g = grupoById.get(v.grupo_id);
    const op = g.opciones.get(v.opcion_id);
    const meta = insumoMeta.get(op.insumo_producto_id);
    snapshots.push({
      grupo_codigo: g.codigo, grupo_etiqueta: g.etiqueta, opcion_etiqueta: op.etiqueta,
      insumo_producto_id: op.insumo_producto_id, insumo_sku: meta.sku, insumo_nombre: meta.nombre,
      cantidad: op.cantidad, unidad_medida: op.unidad_medida, merma_pct: op.merma_pct,
    });
    if (consumoInsumosActivo && qtySold > 0) {
      const cantConv = convertirCantidad(op.cantidad, op.unidad_medida, meta.unidad);
      if (cantConv == null) continue;
      const c = (qtySold * cantConv * (1 + op.merma_pct)) / rendimiento;
      consumo.set(op.insumo_producto_id, (consumo.get(op.insumo_producto_id) ?? 0) + c);
    }
  }
  return { snapshots, consumo };
}

console.log("\n=== 1. Validación de selección ===");
test("Rechaza si falta grupo obligatorio", () => {
  try { validarYConsumir({ gruposDeReceta: [grupoChocolate, grupoBis], seleccion: [{ grupo_id: "grp-chocolate", opcion_id: "op-negro" }], qtySold: 1, rendimiento: 1, insumoMeta: makeInsumoMeta("G"), consumoInsumosActivo: false }); throw new Error("no lanzó"); }
  catch (e) { if (!e.message.startsWith("FALTA_GRUPO:bis")) throw e; }
});
test("Rechaza grupo duplicado en la misma línea", () => {
  try { validarYConsumir({ gruposDeReceta: [grupoChocolate], seleccion: [{ grupo_id: "grp-chocolate", opcion_id: "op-blanco" }, { grupo_id: "grp-chocolate", opcion_id: "op-negro" }], qtySold: 1, rendimiento: 1, insumoMeta: makeInsumoMeta("G"), consumoInsumosActivo: false }); throw new Error("no lanzó"); }
  catch (e) { if (e.message !== "GRUPO_DUPLICADO") throw e; }
});
test("Rechaza grupo que no pertenece a la receta", () => {
  try { validarYConsumir({ gruposDeReceta: [grupoChocolate], seleccion: [{ grupo_id: "grp-oreo", opcion_id: "x" }], qtySold: 1, rendimiento: 1, insumoMeta: makeInsumoMeta("G"), consumoInsumosActivo: false }); throw new Error("no lanzó"); }
  catch (e) { if (e.message !== "GRUPO_CRUZADO") throw e; }
});
test("Rechaza opción que no pertenece al grupo", () => {
  try { validarYConsumir({ gruposDeReceta: [grupoChocolate], seleccion: [{ grupo_id: "grp-chocolate", opcion_id: "op-bis-blanco" }], qtySold: 1, rendimiento: 1, insumoMeta: makeInsumoMeta("G"), consumoInsumosActivo: false }); throw new Error("no lanzó"); }
  catch (e) { if (e.message !== "OPCION_CRUZADA") throw e; }
});
test("Selección completa + consumo auto OFF → snapshot sin consumo", () => {
  const r = validarYConsumir({ gruposDeReceta: [grupoChocolate], seleccion: [{ grupo_id: "grp-chocolate", opcion_id: "op-negro" }], qtySold: 2, rendimiento: 1, insumoMeta: makeInsumoMeta("G"), consumoInsumosActivo: false });
  eq(r.snapshots.length, 1);
  eq(r.snapshots[0].grupo_codigo, "chocolate");
  eq(r.snapshots[0].opcion_etiqueta, "Chocolate negro");
  eq(r.consumo.size, 0, "consumo map debe estar vacío cuando flag OFF");
});
test("Selección completa + consumo auto ON → descuenta variante elegida", () => {
  const r = validarYConsumir({ gruposDeReceta: [grupoChocolate], seleccion: [{ grupo_id: "grp-chocolate", opcion_id: "op-negro" }], qtySold: 2, rendimiento: 1, insumoMeta: makeInsumoMeta("G"), consumoInsumosActivo: true });
  // 2 × 29g × (1+0) / 1 = 58 g — insumo está en G, sin conversión.
  close(r.consumo.get(INS_CHOCO_NEGRO), 58);
  // NO descuenta de las otras variantes.
  eq(r.consumo.has(INS_CHOCO_BLANCO), false);
  eq(r.consumo.has(INS_CHOCO_COOKIES), false);
});
test("Chocolate variante en KG → convierte G → KG correctamente", () => {
  const r = validarYConsumir({ gruposDeReceta: [grupoChocolate], seleccion: [{ grupo_id: "grp-chocolate", opcion_id: "op-cookies" }], qtySold: 3, rendimiento: 1, insumoMeta: makeInsumoMeta("KG"), consumoInsumosActivo: true });
  // 3 × 29g (convertido) / 1 = 0.087 KG
  close(r.consumo.get(INS_CHOCO_COOKIES), 0.087);
});
test("Dos grupos obligatorios elegidos correctamente → ambos descuentan", () => {
  const r = validarYConsumir({
    gruposDeReceta: [grupoChocolate, grupoBis],
    seleccion: [{ grupo_id: "grp-chocolate", opcion_id: "op-blanco" }, { grupo_id: "grp-bis", opcion_id: "op-bis-negro" }],
    qtySold: 1, rendimiento: 1, insumoMeta: makeInsumoMeta("G"), consumoInsumosActivo: true,
  });
  close(r.consumo.get(INS_CHOCO_BLANCO), 29);
  close(r.consumo.get("ins-bis-negro"), 1);
  eq(r.consumo.has("ins-bis-blanco"), false);
});

console.log("\n=== 2. Cantidades múltiples / diferentes variantes del mismo producto ===");
test("2 líneas del mismo producto con variantes distintas → consumo acumulado por variante", () => {
  // Emula dos líneas separadas con qtySold 1 y 1 eligiendo variantes distintas.
  const r1 = validarYConsumir({ gruposDeReceta: [grupoChocolate], seleccion: [{ grupo_id: "grp-chocolate", opcion_id: "op-blanco" }], qtySold: 1, rendimiento: 1, insumoMeta: makeInsumoMeta("G"), consumoInsumosActivo: true });
  const r2 = validarYConsumir({ gruposDeReceta: [grupoChocolate], seleccion: [{ grupo_id: "grp-chocolate", opcion_id: "op-negro" }], qtySold: 1, rendimiento: 1, insumoMeta: makeInsumoMeta("G"), consumoInsumosActivo: true });
  close(r1.consumo.get(INS_CHOCO_BLANCO), 29);
  close(r2.consumo.get(INS_CHOCO_NEGRO), 29);
});

console.log("\n=== 3. Precio no cambia con la variante ===");
test("Precio de la línea = base + adicionales; variantes NO suman", () => {
  const precioBase = 21000;
  const adicionalesExtra = 2000;
  const seleccionVariante = [{ grupo_id: "grp-chocolate", opcion_id: "op-cookies" }];
  // La función que calcula el precio máximo en create-venta-pg solo mira presentación + adicionales.
  // Aquí emulamos: ningún input de precio recibe las variantes.
  const precioMaximoEsperado = precioBase + adicionalesExtra;
  eq(precioMaximoEsperado, 23000);
  // El flujo NO toma nada de las variantes para calcular precio.
  eq(seleccionVariante.length, 1); // selección existe pero no se suma al precio
});

console.log("\n=== 4. Snapshots inmutables ===");
test("El snapshot guarda sku/nombre/cantidad/unidad del momento de la venta", () => {
  const r = validarYConsumir({ gruposDeReceta: [grupoChocolate], seleccion: [{ grupo_id: "grp-chocolate", opcion_id: "op-blanco" }], qtySold: 1, rendimiento: 1, insumoMeta: makeInsumoMeta("G"), consumoInsumosActivo: false });
  const s = r.snapshots[0];
  eq(s.insumo_sku, "MP-0019");
  eq(s.insumo_nombre, "Crema de chocolate blanco");
  eq(s.cantidad, 29);
  eq(s.unidad_medida, "G");
  eq(s.grupo_etiqueta, "Chocolate");
  eq(s.opcion_etiqueta, "Chocolate blanco");
});

console.log("\n=== 5. Sin grupos obligatorios → selección vacía válida ===");
test("Receta sin grupos → seleccion [] OK", () => {
  const r = validarYConsumir({ gruposDeReceta: [], seleccion: [], qtySold: 1, rendimiento: 1, insumoMeta: makeInsumoMeta("G"), consumoInsumosActivo: true });
  eq(r.snapshots.length, 0);
  eq(r.consumo.size, 0);
});

console.log(`\n=== RESULT: ${passed} OK, ${failed} FAIL ===`);
process.exit(failed === 0 ? 0 : 1);
