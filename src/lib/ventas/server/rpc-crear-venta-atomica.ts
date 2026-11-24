/**
 * Fase 2.2 Parte 4 — Wrapper TS para la RPC fn_crear_venta_atomica.
 *
 * El executor TS hace preflight (stock, precios, permisos, FK lookups) y
 * luego arma el payload JSONB que la función PL/pgSQL inserta en una ÚNICA
 * transacción (ventas + ventas_items + venta_item_adicionales +
 * venta_item_variantes + cuentas_por_cobrar). Si cualquier INSERT falla,
 * PostgreSQL hace rollback automático de toda la operación.
 *
 * Fuera de esta función (por ahora): movimientos_inventario + updates de
 * stock_actual para productos controla_stock=true sin receta. Esos quedan
 * en el executor TS actual y se absorberán en la RPC cuando habilitemos
 * consumo automático (NEURA_CONSUMO_AUTO_INSUMOS_ACTIVADAS_EMPRESAS).
 */

import type { AppSupabaseClient } from "@/lib/supabase/schema";

export type AdicionalPayload = {
  adicional_id: string | null;
  adicional_nombre: string;
  precio_unitario: number;
  cantidad?: number;
};

export type VariantePayload = {
  grupo_id: string;
  opcion_id: string;
  grupo_codigo: string;
  grupo_etiqueta: string;
  opcion_etiqueta: string;
  insumo_producto_id: string;
  insumo_sku: string;
  insumo_nombre: string;
  cantidad: number;
  unidad_medida: string;
  merma_pct: number;
  /** Costo del insumo al momento de la venta. Snapshot inmutable. */
  costo_unitario_snapshot?: number;
};

export type ItemPayload = {
  id: string;                       // uuid pre-generado por el executor
  producto_id: string;
  producto_nombre: string;
  sku: string;
  cantidad: number;
  precio_venta_original: number;
  precio_venta: number;
  tipo_iva: "EXENTA" | "5%" | "10%";
  tipo_precio: "minorista" | "mayorista" | "distribuidor" | "costo";
  subtotal: number;
  monto_iva: number;
  total_linea: number;
  nota?: string | null;
  presentacion_id?: string | null;
  adicionales?: AdicionalPayload[];
  variantes?: VariantePayload[];
};

export type VentaHeaderPayload = {
  numero_control: string;
  fecha: string;                    // ISO
  total: number;
  subtotal: number;
  monto_iva: number;
  tipo_iva_resumen: string;
  tipo_venta: "CONTADO" | "CREDITO";
  plazo_dias: number | null;
  fecha_vencimiento: string | null; // YYYY-MM-DD
  moneda: "GS" | "USD";
  tipo_cambio: number;
  cliente_id: string | null;
  observaciones: string | null;
  metodo_pago: string | null;
  caja_id: string | null;
  created_by: string | null;
  usuario_nombre: string | null;
  genera_nota_remision: boolean;
};

export type CxCPayload = {
  numero_cuota: number;
  monto: number;
  saldo: number;
  fecha_vencimiento: string;        // YYYY-MM-DD
} | null;

export type StockUpdatePayload = {
  producto_id: string;
  nuevo_stock: number;
  movimiento?: {
    producto_nombre: string;
    producto_sku: string;
    tipo: "ENTRADA" | "SALIDA";
    cantidad: number;
    costo_unitario: number | null;
    origen: "venta" | "merma" | "ajuste_manual" | "inventario_inicial" | "compra";
    referencia: string | null;
    fecha?: string;
    created_by?: string | null;
    usuario_nombre?: string | null;
  };
};

export type CrearVentaAtomicaPayload = {
  empresa_id: string;
  venta: VentaHeaderPayload;
  items: ItemPayload[];
  cxc: CxCPayload;
  /** Updates de stock + movimientos (productos controla_stock y/o insumos cuando consumo ON). */
  stock_updates?: StockUpdatePayload[];
};

export async function crearVentaAtomica(
  sb: AppSupabaseClient,
  payload: CrearVentaAtomicaPayload,
): Promise<{ venta_id: string }> {
  if (payload.items.length === 0) {
    throw new Error("items debe ser array no vacío");
  }
  // supabase.rpc() mapea a un único POST /rpc/<fn> — el servidor corre la
  // función en su propia transacción, así que el rollback es intrínseco.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any).rpc("fn_crear_venta_atomica", { p_payload: payload });
  if (error) {
    throw new Error(`fn_crear_venta_atomica: ${error.message}`);
  }
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0 || !rows[0]?.venta_id) {
    throw new Error("fn_crear_venta_atomica no devolvió venta_id");
  }
  return { venta_id: String(rows[0].venta_id) };
}
