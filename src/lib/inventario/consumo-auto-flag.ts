/**
 * Fase 2.2 Parte 1 — Feature flag "consumo automático de insumos al vender".
 *
 * Diseño de seguridad:
 *   - Empresas en `DEFAULT_OFF_EMPRESAS` (ej: Açaí House) tienen el consumo
 *     AUTOMÁTICAMENTE DESACTIVADO por defecto. No depende de env vars.
 *     Para activarlas requiere opt-in INEQUÍVOCO vía
 *     `NEURA_CONSUMO_AUTO_INSUMOS_ACTIVADAS_EMPRESAS` (CSV de empresa_ids).
 *   - El resto de los tenants (comportamiento legacy) tiene el consumo ACTIVADO
 *     por defecto. Pueden desactivarse opcionalmente con
 *     `NEURA_CONSUMO_AUTO_INSUMOS_DISABLED_EMPRESAS` (CSV).
 *
 * Por qué default-OFF para Açaí House: durante Fase 2.2 Parte 1 las recetas se
 * cargan incrementalmente. Descontar insumos con recetas incompletas genera
 * inventario incorrecto. La protección NO depende de que alguien recuerde
 * setear una env var — está hardcodeada en el código.
 *
 * Afecta solo descuentos de INSUMOS (recetas y adicionales). No toca el
 * descuento de stock propio de productos `controla_stock=true`, que sigue
 * funcionando normalmente (p.ej. GASEOSA 500 L).
 */

/** Empresas que requieren opt-in explícito. Hardcodeado por decisión Fase 2.2 Parte 1. */
const DEFAULT_OFF_EMPRESAS: ReadonlySet<string> = new Set([
  "a9276529-bca9-418a-b014-375e68d667d2", // Açaí House
]);

let cachedActivadas: Set<string> | null = null;
let cachedDisabled: Set<string> | null = null;

function parseCsv(raw: string | undefined): Set<string> {
  return new Set((raw ?? "").split(",").map((s) => s.trim()).filter((s) => s.length > 0));
}
function loadActivadas(): Set<string> {
  return parseCsv(process.env.NEURA_CONSUMO_AUTO_INSUMOS_ACTIVADAS_EMPRESAS);
}
function loadDisabled(): Set<string> {
  return parseCsv(process.env.NEURA_CONSUMO_AUTO_INSUMOS_DISABLED_EMPRESAS);
}

/**
 * Devuelve true si el consumo automático de insumos está habilitado para esta empresa.
 *
 * Reglas (en este orden):
 *  1. Si la empresa está en DEFAULT_OFF_EMPRESAS (Açaí House):
 *       solo ON si está explícita en `NEURA_CONSUMO_AUTO_INSUMOS_ACTIVADAS_EMPRESAS`.
 *       Ausencia de env var → OFF.
 *       Variables mal escritas / vacías / sin este empresa_id → OFF.
 *  2. Resto de tenants (legacy):
 *       ON por default. OFF solo si está en `NEURA_CONSUMO_AUTO_INSUMOS_DISABLED_EMPRESAS`.
 */
export function consumoAutoInsumosActivo(empresaId: string): boolean {
  if (DEFAULT_OFF_EMPRESAS.has(empresaId)) {
    if (cachedActivadas === null) cachedActivadas = loadActivadas();
    return cachedActivadas.has(empresaId);
  }
  if (cachedDisabled === null) cachedDisabled = loadDisabled();
  return !cachedDisabled.has(empresaId);
}

/** Útil para tests: resetea los caches de CSV env vars. */
export function _resetConsumoAutoCache(): void {
  cachedActivadas = null;
  cachedDisabled = null;
}

/** Expuesto para diagnóstico / UI de admin. */
export function esEmpresaDefaultOff(empresaId: string): boolean {
  return DEFAULT_OFF_EMPRESAS.has(empresaId);
}
