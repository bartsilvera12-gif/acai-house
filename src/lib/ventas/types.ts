export type TipoIvaVenta = "EXENTA" | "5%" | "10%";
export type TipoVenta   = "CONTADO" | "CREDITO";
export type MonedaVenta = "GS" | "USD";
export type MetodoPago  = "efectivo" | "tarjeta" | "transferencia";
/** Nivel de precio elegido para la línea de venta.
 *  'costo' se conserva SOLO como histórico (ventas viejas); ya no se ofrece en la UI. */
export type TipoPrecioVenta = "minorista" | "mayorista" | "distribuidor" | "costo";

/** Adicional aplicado a una línea de venta (Fase 1 Açaí House). */
export interface AdicionalLinea {
  id: string;
  nombre: string;
  /** Precio unitario en Gs. (ya convertido a GS si la venta es en USD). */
  precio: number;
}

/** Variante obligatoria elegida por el cliente (Fase 2.2 Parte 4 Açaí House).
 *  grupo_id apunta a receta_grupos_variante; opcion_id a receta_grupo_opciones.
 *  La selección NO modifica el precio. */
export interface VarianteElegida {
  grupo_id: string;
  opcion_id: string;
  /** Snapshot visible — solo para render en el carrito. Se re-arma en backend al snapshot DB. */
  grupo_etiqueta?: string;
  opcion_etiqueta?: string;
}

/** Un ítem dentro de una venta (una línea de producto). */
export interface LineaVenta {
  producto_id:           string;
  producto_nombre:       string;
  sku:                   string;
  cantidad:              number;
  precio_venta_original: number;  // en la moneda elegida
  precio_venta:          number;  // siempre en GS (incluye adicionales si aplica)
  tipo_iva:              TipoIvaVenta;
  /** Nivel de precio aplicado: minorista (precio_venta) | mayorista (precio_mayorista) | costo (costo_promedio). */
  tipo_precio?:          TipoPrecioVenta;
  subtotal:              number;  // precio_venta × cantidad
  monto_iva:             number;
  total_linea:           number;  // subtotal + monto_iva
  /** Variación/nota del ítem para la cocina (ej: "sin leche condensada"). Opcional. */
  nota?:                 string | null;
  /** Presentación/tamaño elegido (Chico/Mediano/Grande). */
  presentacion_id?:      string | null;
  presentacion_nombre?:  string | null;
  /** Adicionales sumados al precio de la línea. */
  adicionales?:          AdicionalLinea[];
  /** Variantes obligatorias elegidas (chocolate/bis/oreo…). No modifican precio. */
  variantes_elegidas?:   VarianteElegida[];
}

/** Cabecera de venta: condiciones comerciales + totales consolidados. */
export interface Venta {
  /** UUID en base de datos (antes del bloque DB-first era numérico local). */
  id:             string;
  numero_control: string;   // VTA-000001, VTA-000002, …

  items: LineaVenta[];       // 1 o más productos

  moneda:      MonedaVenta;
  tipo_cambio: number;       // 1 si moneda === "GS"

  subtotal:  number;         // Σ subtotal de ítems
  monto_iva: number;         // Σ monto_iva de ítems
  total:     number;         // Σ total_linea de ítems

  tipo_venta: TipoVenta;
  plazo_dias?: number;       // solo si tipo_venta === "CREDITO"

  metodo_pago?: MetodoPago;  // En lo de Mari: efectivo/tarjeta/transferencia

  /** La venta emite nota de remisión (documento no fiscal). */
  genera_nota_remision?: boolean;
  /** Número de nota de remisión (NR-XXXXXX) si genera_nota_remision. */
  nota_remision_numero?: string | null;

  fecha: string;             // ISO string, generado automáticamente
}
