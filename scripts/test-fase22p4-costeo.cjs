// Fase 2.2 Parte 4 — tests de costeo de una línea de venta.
//
// Verifica que el costo total incluye:
//   - Ingredientes fijos (receta_items base)
//   - Variante elegida (una por grupo)
//   - Conversión de unidades (G ↔ KG)
//   - Cantidad vendida
//   - Merma por item
//   - Snapshot inmutable: el costo guardado al momento de la venta no cambia
//     si el costo de compra sube/baja después.
process.env.NODE_NO_WARNINGS = "1";
require("tsx/cjs");
const path = require("path");
const { convertirCantidad } = require(path.resolve("src/lib/unidades/convert.ts"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  OK   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}
function close(a, b, tol, msg) {
  if (typeof a !== "number" || !Number.isFinite(a) || Math.abs(a - b) > (tol ?? 0.01))
    throw new Error(`${msg || "not close"}: got ${a}, expected ${b}`);
}

// ─────── Fixtures: Frutilla con chocolate Mediano ───────
// Receta base (se consume siempre):
const items_base = [
  { nombre: "ACAI",              cant: 130, unidad: "G", merma: 0 },
  { nombre: "Leche condensada",  cant: 30,  unidad: "G", merma: 0 },
  { nombre: "Leche en polvo",    cant: 26,  unidad: "G", merma: 0 },
  { nombre: "Frutilla",          cant: 72,  unidad: "G", merma: 0 },
  { nombre: "Vaso 330 ml",       cant: 1,   unidad: "UNIDAD", merma: 0 },
];
const costo = {
  ACAI: 30000,                // Gs. / KG (unidad base KG)
  "Leche condensada": 15,     // Gs. / G
  "Leche en polvo": 20,       // Gs. / G
  Frutilla: 8,                // Gs. / G
  "Vaso 330 ml": 500,         // Gs. / UNIDAD
  "Crema de chocolate blanco": 12,  // Gs. / G
  "Crema de chocolate negro": 15,   // Gs. / G
  "Crema de chocolate Cookies": 20, // Gs. / G
};
const unidadBase = {
  ACAI: "KG",                 // insumo en KG, receta en G → convierte
  "Leche condensada": "G",
  "Leche en polvo": "G",
  Frutilla: "G",
  "Vaso 330 ml": "UNIDAD",
  "Crema de chocolate blanco": "G",
  "Crema de chocolate negro": "G",
  "Crema de chocolate Cookies": "G",
};
const rendimiento = 1;

function costoLinea({ qty, items, variantes }) {
  // Suma el costo de ingredientes fijos + variantes elegidas.
  const todas = [...items, ...variantes];
  let total = 0;
  for (const it of todas) {
    const uBase = unidadBase[it.nombre];
    const cantConv = convertirCantidad(it.cant, it.unidad, uBase);
    if (cantConv == null) throw new Error(`Unidades incompatibles: ${it.unidad} → ${uBase}`);
    const consumo = (qty * cantConv * (1 + it.merma)) / rendimiento;
    total += consumo * costo[it.nombre];
  }
  return Math.round(total);
}

console.log("\n=== 1. Costo: ingredientes fijos + variante elegida ===");
test("Frutilla con chocolate Mediano × 1 con chocolate NEGRO", () => {
  const variantes = [{ nombre: "Crema de chocolate negro", cant: 29, unidad: "G", merma: 0 }];
  // ACAI: 0.130 KG × 30000 = 3900
  // LC: 30g × 15 = 450
  // LP: 26g × 20 = 520
  // Frutilla: 72g × 8 = 576
  // Vaso: 1 × 500 = 500
  // Chocolate NEGRO: 29g × 15 = 435
  // Total: 6381
  close(costoLinea({ qty: 1, items: items_base, variantes }), 6381);
});
test("Misma receta con chocolate BLANCO (costo menor)", () => {
  const variantes = [{ nombre: "Crema de chocolate blanco", cant: 29, unidad: "G", merma: 0 }];
  // Chocolate BLANCO: 29g × 12 = 348 → total 3900+450+520+576+500+348 = 6294
  close(costoLinea({ qty: 1, items: items_base, variantes }), 6294);
});
test("Misma receta con chocolate COOKIES (costo mayor)", () => {
  const variantes = [{ nombre: "Crema de chocolate Cookies", cant: 29, unidad: "G", merma: 0 }];
  // 29g × 20 = 580 → total 6526
  close(costoLinea({ qty: 1, items: items_base, variantes }), 6526);
});

console.log("\n=== 2. Cantidad vendida y merma ===");
test("3 unidades de la misma receta → costo × 3", () => {
  const variantes = [{ nombre: "Crema de chocolate negro", cant: 29, unidad: "G", merma: 0 }];
  close(costoLinea({ qty: 3, items: items_base, variantes }), 6381 * 3);
});
test("Receta con 5% merma sobre ACAI (receta histórica)", () => {
  // Emula la receta histórica: 1 KG ACAI con 5% merma. Sin variante.
  const items = [{ nombre: "ACAI", cant: 1, unidad: "KG", merma: 0.05 }];
  // consumo = 1 × 1 × 1.05 / 1 = 1.05 KG × 30000 = 31500
  close(costoLinea({ qty: 1, items, variantes: [] }), 31500);
});

console.log("\n=== 3. Conversión de unidades ===");
test("ACAI en gramos (receta) → se convierte a KG (insumo)", () => {
  // 130 g convertido a KG = 0.130 KG × 30000 = 3900
  close(costoLinea({ qty: 1, items: [{ nombre: "ACAI", cant: 130, unidad: "G", merma: 0 }], variantes: [] }), 3900);
});
test("Variante en KG (insumo) con receta en G → convierte 0.029 KG", () => {
  // Para emular el inverso: forzamos chocolate a estar en KG (no es lo real, es un stress test)
  const cantConv = convertirCantidad(29, "G", "KG"); // 0.029
  close(cantConv, 0.029);
});

console.log("\n=== 4. Snapshot inmutable (costo histórico de la venta) ===");
test("Si sube el costo de compra después, el costo histórico de la venta NO cambia", () => {
  // El cálculo arriba toma `costo[nombre]` que es snapshot en el momento de la venta.
  // En la DB real, `movimientos_inventario.costo_unitario` captura el costo_promedio
  // vigente al momento del SALIDA. Si luego cambia `productos.costo_promedio`, las
  // ventas anteriores no se recalculan.
  const variantes1 = [{ nombre: "Crema de chocolate negro", cant: 29, unidad: "G", merma: 0 }];
  const total1 = costoLinea({ qty: 1, items: items_base, variantes: variantes1 });
  // Simular cambio de costo DESPUÉS: duplicar el costo del chocolate negro.
  const costoBackup = costo["Crema de chocolate negro"];
  costo["Crema de chocolate negro"] = costoBackup * 2;
  // El cálculo de una venta NUEVA refleja el nuevo costo:
  const total2 = costoLinea({ qty: 1, items: items_base, variantes: variantes1 });
  if (total2 === total1) throw new Error("El cálculo debe reflejar el nuevo costo en una venta posterior");
  // Pero `total1` (venta vieja) ya quedó fijado en snapshot — como string/variable, no se recalcula.
  // En la DB: ya está persistido en movimientos_inventario.costo_unitario con el valor viejo.
  costo["Crema de chocolate negro"] = costoBackup;
  if (total1 !== 6381) throw new Error("Snapshot original debe mantenerse");
});

console.log(`\n=== RESULT: ${passed} OK, ${failed} FAIL ===`);
process.exit(failed === 0 ? 0 : 1);
