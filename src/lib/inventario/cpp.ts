/**
 * Fase 2.1 — Cálculo de Costo Promedio Ponderado (CPP) para compras.
 *
 * Fórmula estándar (CPP, método de valuación por ingreso):
 *   nuevo_costo = (stock_anterior * costo_anterior + cantidad_recibida * costo_nuevo)
 *                 / (stock_anterior + cantidad_recibida)
 *
 * Ambas cantidades deben estar en la MISMA unidad base (ej: gramos). El caller
 * es responsable de normalizar antes de invocar esta función.
 *
 * Casos borde cubiertos:
 *   - stock_anterior <= 0 (nunca hubo stock o negativo por ajuste): devuelve
 *     el costo nuevo (no se puede ponderar contra algo que no existe).
 *   - costo_anterior <= 0 o nulo: devuelve el costo nuevo (desconocido previo).
 *   - cantidad_recibida <= 0: devuelve el costo anterior (no hay entrada real).
 *   - Denominador cero (ambas en 0): devuelve el costo nuevo.
 *   - Entradas NaN/Infinity: devuelve el costo nuevo si es finito, sino 0.
 *
 * En ningún caso lanza excepciones ni divide por cero.
 */
export function calcularNuevoCostoPromedio(
  stockAnterior: number,
  costoAnterior: number,
  cantidadRecibida: number,
  costoNuevo: number
): number {
  const sa = Number.isFinite(stockAnterior) ? stockAnterior : 0;
  const ca = Number.isFinite(costoAnterior) && costoAnterior > 0 ? costoAnterior : 0;
  const cr = Number.isFinite(cantidadRecibida) ? cantidadRecibida : 0;
  const cn = Number.isFinite(costoNuevo) && costoNuevo >= 0 ? costoNuevo : 0;

  if (cr <= 0) return ca > 0 ? ca : cn;           // no entra nada nuevo
  // Compra sin costo informado (ej. materia prima comprada por caja sin
  // desglose por unidad): mantener el CPP previo. Nunca "diluir" con 0
  // porque "no sé el costo" ≠ "el costo es 0".
  if (cn <= 0) return ca > 0 ? ca : 0;
  if (sa <= 0 || ca <= 0) return cn;              // sin stock previo o costo previo desconocido
  const denom = sa + cr;
  if (denom <= 0) return cn;                      // seguridad
  return (sa * ca + cr * cn) / denom;
}
