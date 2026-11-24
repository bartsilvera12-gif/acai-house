// Fase 2.2 Parte 4 — tests de la lógica pura del picker (seleccionCompleta, gruposFaltantes).
process.env.NODE_NO_WARNINGS = "1";
require("tsx/cjs");
const path = require("path");
const { seleccionCompleta, gruposFaltantes } = require(path.resolve("src/components/ventas/RecetaVariantesPicker.tsx"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  OK   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || "mismatch"}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); }

const mkGrupo = (id, obligatorio, opcionesIds) => ({
  id, codigo: id, etiqueta: id.toUpperCase(), obligatorio, orden: 0,
  opciones: opcionesIds.map((oid) => ({ id: oid, etiqueta: oid, insumo_nombre: null, insumo_sku: null, cantidad: 1, unidad_medida: "G" })),
});

console.log("\n=== Lógica del picker ===");
test("Sin grupos → completo", () => eq(seleccionCompleta([], []), true));
test("1 grupo obligatorio sin selección → incompleto", () =>
  eq(seleccionCompleta([mkGrupo("choco", true, ["a", "b"])], []), false));
test("1 grupo obligatorio con selección válida → completo", () =>
  eq(seleccionCompleta([mkGrupo("choco", true, ["a", "b"])], [{ grupo_id: "choco", opcion_id: "a" }]), true));
test("1 grupo obligatorio con opcion_id inexistente → incompleto", () =>
  eq(seleccionCompleta([mkGrupo("choco", true, ["a", "b"])], [{ grupo_id: "choco", opcion_id: "zzz" }]), false));
test("Grupo no obligatorio sin elección → completo", () =>
  eq(seleccionCompleta([mkGrupo("salsa", false, ["x"])], []), true));
test("2 grupos obligatorios, uno elegido, otro no → incompleto", () =>
  eq(seleccionCompleta(
    [mkGrupo("choco", true, ["a"]), mkGrupo("bis", true, ["b"])],
    [{ grupo_id: "choco", opcion_id: "a" }]
  ), false));
test("gruposFaltantes nombra los pendientes por etiqueta", () =>
  eq(gruposFaltantes(
    [mkGrupo("choco", true, ["a"]), mkGrupo("bis", true, ["b"])],
    [{ grupo_id: "bis", opcion_id: "b" }]
  ), ["CHOCO"]));

console.log(`\n=== RESULT: ${passed} OK, ${failed} FAIL ===`);
process.exit(failed === 0 ? 0 : 1);
