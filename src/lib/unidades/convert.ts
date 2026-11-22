/**
 * Conversión de unidades por familia (masa / volumen / conteo) para el costeo de
 * recetas y el descuento de stock. NO inventa densidades: solo convierte dentro
 * de la misma familia. Unidad base: masa=g, volumen=ml, conteo=unidad.
 *
 * Factores a la unidad base:
 *   masa:   G=1, KG=1000
 *   vol:    ML=1, L=1000, LT=1000
 *   conteo: UNIDAD=1
 */

export type FamiliaUnidad = "masa" | "volumen" | "conteo" | "otro";

const FACTOR: Record<string, number> = {
  G: 1, GR: 1, GRS: 1, GRAMO: 1, GRAMOS: 1,
  KG: 1000, KGS: 1000, KILO: 1000, KILOS: 1000,
  ML: 1, MILILITRO: 1, MILILITROS: 1,
  L: 1000, LT: 1000, LTS: 1000, LITRO: 1000, LITROS: 1000,
  UNIDAD: 1, UNID: 1, U: 1, UN: 1, UNIDADES: 1,
};

const FAMILIA: Record<string, FamiliaUnidad> = {
  G: "masa", GR: "masa", GRS: "masa", GRAMO: "masa", GRAMOS: "masa",
  KG: "masa", KGS: "masa", KILO: "masa", KILOS: "masa",
  ML: "volumen", MILILITRO: "volumen", MILILITROS: "volumen",
  L: "volumen", LT: "volumen", LTS: "volumen", LITRO: "volumen", LITROS: "volumen",
  UNIDAD: "conteo", UNID: "conteo", U: "conteo", UN: "conteo", UNIDADES: "conteo",
};

function key(u: string | null | undefined): string {
  return (u ?? "").trim().toUpperCase();
}

export function familiaUnidad(u: string | null | undefined): FamiliaUnidad {
  return FAMILIA[key(u)] ?? "otro";
}

/** Factor a la unidad base de su familia; null si la unidad es desconocida. */
export function factorUnidad(u: string | null | undefined): number | null {
  const f = FACTOR[key(u)];
  return f ?? null;
}

/** ¿Dos unidades pertenecen a la misma familia conocida (convertibles entre sí)? */
export function unidadesCompatibles(a: string | null | undefined, b: string | null | undefined): boolean {
  const fa = familiaUnidad(a);
  const fb = familiaUnidad(b);
  return fa !== "otro" && fa === fb;
}

/**
 * Convierte `cantidad` desde la unidad `desde` a la unidad `hacia`.
 * Devuelve null si las unidades no son compatibles (familias distintas o desconocidas).
 * Ej: convertirCantidad(250, "G", "KG") = 0.25
 */
export function convertirCantidad(
  cantidad: number,
  desde: string | null | undefined,
  hacia: string | null | undefined
): number | null {
  if (!unidadesCompatibles(desde, hacia)) return null;
  const fDesde = factorUnidad(desde);
  const fHacia = factorUnidad(hacia);
  if (fDesde == null || fHacia == null || fHacia === 0) return null;
  return (cantidad * fDesde) / fHacia;
}

// ======================================================================
// Fase 2.1 — Empaques de compra (cajas, bolsas, paquetes, tiras)
// ======================================================================
//
// Reutiliza las familias de unidades (masa/volumen/conteo) para calcular el
// factor automático de un empaque. "Caja 8 kg" → 8000 g (factor_compra_receta).
// "Tira 50 unidades" → 50 u. No inventa densidades: si la unidad del contenido
// no es reconocible, devuelve factor=null y el humano debe cargar manualmente.

/** Tipos de empaque reconocidos por la UI de productos. */
export type TipoEmpaque = "Caja" | "Bolsa" | "Paquete" | "Tira" | "Kilogramo" | "Unidad";

export const TIPOS_EMPAQUE: readonly TipoEmpaque[] = [
  "Caja", "Bolsa", "Paquete", "Tira", "Kilogramo", "Unidad",
];

/**
 * Describe un empaque estructurado. `contenido` es la cantidad expresada en
 * `unidad_contenido` (ej: 8 kg, 50 u).
 */
export interface Empaque {
  tipo: TipoEmpaque;
  contenido: number;
  unidad_contenido: string; // libre (KG, G, L, UNIDAD, …)
}

/**
 * Compone la etiqueta humana para guardar como `unidad_compra` o
 * `unidad_compra_snapshot`. Ej: ({tipo:"Caja", contenido:8, unidad_contenido:"KG"})
 * → "Caja 8 kg". Para "Kilogramo" o "Unidad" simples usa solo el tipo.
 */
export function etiquetaEmpaque(e: Empaque): string {
  const uBase = key(e.unidad_contenido);
  if (e.tipo === "Kilogramo") return "Kilogramo";
  if (e.tipo === "Unidad") return "Unidad";
  // normalizo "KG" → "kg", "UNIDAD" → "unidades", etc.
  const u = uBase === "UNIDAD" || uBase === "U" || uBase === "UN" || uBase === "UNIDADES" || uBase === "UNID"
    ? "unidades"
    : uBase.toLowerCase();
  return `${e.tipo} ${e.contenido} ${u}`.trim();
}

/**
 * Factor del empaque a la unidad de receta. Ej: empaque {Caja, 8, KG} + unidad
 * receta "G" → 8000. Devuelve null si las unidades no son convertibles.
 */
export function factorEmpaque(e: Empaque, unidadReceta: string | null | undefined): number | null {
  // "Kilogramo" y "Unidad" son casos triviales: 1 kg = 1 de contenido kg.
  if (e.tipo === "Kilogramo") {
    return convertirCantidad(1, "KG", unidadReceta);
  }
  if (e.tipo === "Unidad") {
    return convertirCantidad(1, "UNIDAD", unidadReceta);
  }
  if (!(e.contenido > 0)) return null;
  return convertirCantidad(e.contenido, e.unidad_contenido, unidadReceta);
}

/**
 * Parsea una etiqueta libre existente (compat con productos ya cargados con
 * texto). Reconoce formatos: "Caja 8 kg", "Bolsa 25 KG", "Paquete 16 unidades",
 * "Tira 50 u", "Kilogramo", "Unidad", "1 kg", "500 g".
 *
 * Devuelve null cuando no puede reconocer el formato — en ese caso la UI
 * fallback a texto libre con warning.
 */
export function parseEmpaque(label: string | null | undefined): Empaque | null {
  if (!label) return null;
  const raw = label.trim();
  if (!raw) return null;
  const up = raw.toUpperCase();
  if (up === "KILOGRAMO" || up === "KG") {
    return { tipo: "Kilogramo", contenido: 1, unidad_contenido: "KG" };
  }
  if (up === "UNIDAD" || up === "UNIDADES" || up === "U" || up === "UN") {
    return { tipo: "Unidad", contenido: 1, unidad_contenido: "UNIDAD" };
  }
  // Patrón "<Tipo> <num> <unidad>"
  const m = raw.match(/^\s*(Caja|Bolsa|Paquete|Tira)\s+(\d+(?:[.,]\d+)?)\s*([A-Za-z]+)\s*$/i);
  if (m) {
    const tipoRaw = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    const tipo = tipoRaw as TipoEmpaque;
    const contenido = Number(m[2].replace(",", "."));
    const unidad = m[3].toUpperCase();
    if (!Number.isFinite(contenido) || contenido <= 0) return null;
    // Validamos que la unidad del contenido sea conocida (de alguna familia).
    if (familiaUnidad(unidad) === "otro") return null;
    return { tipo, contenido, unidad_contenido: unidad };
  }
  // Fallback: "<num> <unidad>" → se asimila a Paquete.
  const m2 = raw.match(/^\s*(\d+(?:[.,]\d+)?)\s*([A-Za-z]+)\s*$/);
  if (m2) {
    const contenido = Number(m2[1].replace(",", "."));
    const unidad = m2[2].toUpperCase();
    if (!Number.isFinite(contenido) || contenido <= 0) return null;
    if (familiaUnidad(unidad) === "otro") return null;
    return { tipo: "Paquete", contenido, unidad_contenido: unidad };
  }
  return null;
}
