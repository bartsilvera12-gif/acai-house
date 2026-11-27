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

/**
 * El cliente SOLO manda `grupo_id` y `opcion_id`. El resto del snapshot
 * (etiquetas, cantidad, unidad, merma, costo_unitario_snapshot) lo rellena
 * la RPC leyendo del server. Previene manipulación del cliente.
 */
export type VariantePayload = {
  grupo_id: string;
  opcion_id: string;
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

/**
 * Delta atómico sobre un producto. El cliente envía `delta_qty` (siempre
 * positivo, SALIDA); la RPC hace `UPDATE productos SET stock_actual =
 * GREATEST(0, stock_actual - delta_qty) WHERE id=... FOR UPDATE` y
 * valida permitir_sin_stock. Previene lost-update en ventas concurrentes.
 * `costo_unitario` del movimiento lo captura la RPC leyendo productos
 * dentro del mismo FOR UPDATE — NO se confía en el cliente.
 */
export type StockDeltaPayload = {
  producto_id: string;
  delta_qty: number;
  movimiento?: {
    tipo?: "SALIDA";
    origen?: "venta";
    referencia: string | null;
    created_by?: string | null;
    usuario_nombre?: string | null;
  };
};

export type CrearVentaAtomicaPayload = {
  empresa_id: string;
  /** Autoriza vender aunque falte stock (política existente). Default false. */
  permitir_sin_stock?: boolean;
  venta: VentaHeaderPayload;
  items: ItemPayload[];
  cxc: CxCPayload;
  /** Deltas de stock (productos y/o insumos). RPC hace UPDATE atómico con FOR UPDATE. */
  stock_deltas?: StockDeltaPayload[];
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
