import type { Factura, Tipificacion, TipoGestion, ResultadoTipificacion } from "./types";

// ─── Mock: Facturas ───────────────────────────────────────────────────────────

const FACTURAS_MOCK: Factura[] = [
  // DISTRIBUIDORA NORTE S.A. (cliente_id: 1)
  { id: 1,  cliente_id: 1, numero_factura: "FACT-000001", fecha: "2026-01-15", fecha_vencimiento: "2026-02-14", monto: 5500000,  saldo: 0,        estado: "Pagado",    tipo: "credito", moneda: "GS" },
  { id: 2,  cliente_id: 1, numero_factura: "FACT-000002", fecha: "2026-02-10", fecha_vencimiento: "2026-03-11", monto: 8200000,  saldo: 8200000,  estado: "Vencido",   tipo: "credito", moneda: "GS" },
  { id: 3,  cliente_id: 1, numero_factura: "FACT-000003", fecha: "2026-03-05", fecha_vencimiento: "2026-04-04", monto: 12000000, saldo: 12000000, estado: "Pendiente",  tipo: "credito", moneda: "GS" },
  // JUAN CARLOS ORTEGA (cliente_id: 2)
  { id: 4,  cliente_id: 2, numero_factura: "FACT-000004", fecha: "2026-02-20", fecha_vencimiento: "2026-02-20", monto: 350000,   saldo: 0,        estado: "Pagado",    tipo: "contado", moneda: "GS" },
  { id: 5,  cliente_id: 2, numero_factura: "FACT-000005", fecha: "2026-03-05", fecha_vencimiento: "2026-03-05", monto: 480000,   saldo: 0,        estado: "Pagado",    tipo: "contado", moneda: "GS" },
  { id: 6,  cliente_id: 2, numero_factura: "FACT-000006", fecha: "2026-03-09", fecha_vencimiento: "2026-03-09", monto: 220000,   saldo: 220000,   estado: "Pendiente",  tipo: "contado", moneda: "GS" },
  // FARMACIA CENTRAL S.R.L. (cliente_id: 3)
  { id: 7,  cliente_id: 3, numero_factura: "FACT-000007", fecha: "2026-01-20", fecha_vencimiento: "2026-01-20", monto: 1500000,  saldo: 0,        estado: "Pagado",    tipo: "contado", moneda: "GS" },
  { id: 8,  cliente_id: 3, numero_factura: "FACT-000008", fecha: "2026-02-05", fecha_vencimiento: "2026-02-05", monto: 980000,   saldo: 0,        estado: "Pagado",    tipo: "contado", moneda: "GS" },
  { id: 9,  cliente_id: 3, numero_factura: "FACT-000009", fecha: "2026-03-01", fecha_vencimiento: "2026-03-31", monto: 3200000,  saldo: 3200000,  estado: "Pendiente",  tipo: "credito", moneda: "GS" },
  // CONSTRUCTORA DEL ESTE S.A. (cliente_id: 4)
  { id: 10, cliente_id: 4, numero_factura: "FACT-000010", fecha: "2025-11-15", fecha_vencimiento: "2025-12-15", monto: 18000000, saldo: 0,        estado: "Pagado",    tipo: "credito", moneda: "USD" },
  { id: 11, cliente_id: 4, numero_factura: "FACT-000011", fecha: "2025-12-01", fecha_vencimiento: "2026-01-30", monto: 25000000, saldo: 25000000, estado: "Vencido",   tipo: "credito", moneda: "USD" },
  { id: 12, cliente_id: 4, numero_factura: "FACT-000012", fecha: "2026-02-01", fecha_vencimiento: "2026-03-01", monto: 15000000, saldo: 15000000, estado: "Vencido",   tipo: "credito", moneda: "USD" },
];

// ─── Mock: Tipificaciones ─────────────────────────────────────────────────────

const TIPIFICACIONES_MOCK: Tipificacion[] = [
  {
    id:           1,
    cliente_id:   1,
    fecha:        "2026-03-01T10:30:00.000Z",
    usuario:      "JUAN PÉREZ",
    tipo_gestion: "Seguimiento",
    resultado:    "Pendiente",
    observacion:  "Cliente consultó sobre la factura FACT-000002. Prometió pago para el 20/03.",
  },
  {
    id:           2,
    cliente_id:   1,
    fecha:        "2026-02-15T14:00:00.000Z",
    usuario:      "MARIA LOPEZ",
    tipo_gestion: "Reclamo",
    resultado:    "Resuelto",
    observacion:  "Reclamo por error en factura FACT-000001 corregido. Se emitió nota de crédito.",
  },
  {
    id:           3,
    cliente_id:   3,
    fecha:        "2026-02-28T09:00:00.000Z",
    usuario:      "CARLOS VEGA",
    tipo_gestion: "Consulta",
    resultado:    "Resuelto",
    observacion:  "Consulta sobre disponibilidad de productos. Informado correctamente.",
  },
  {
    id:           4,
    cliente_id:   4,
    fecha:        "2026-02-05T11:00:00.000Z",
    usuario:      "JUAN PÉREZ",
    tipo_gestion: "Promesa de pago",
    resultado:    "Escalar",
    observacion:  "Cliente no respondió llamadas. Deuda vencida de USD 40.000. Elevar a jefatura.",
  },
];

// ─── Claves localStorage ──────────────────────────────────────────────────────

const KEY_TIPIFICACIONES = "neura_tipificaciones";
const KEY_FACTURAS       = "neura_facturas";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeGet<T>(key: string, fallback: T): T {
  try {
    const item = localStorage.getItem(key);
    return item ? (JSON.parse(item) as T) : fallback;
  } catch { return fallback; }
}

function safeSet(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* noop */ }
}

// ─── Facturas ─────────────────────────────────────────────────────────────────

function getFacturasBase(): Factura[] {
  const stored = safeGet<Factura[]>(KEY_FACTURAS, []);
  return stored.length > 0 ? stored : [...FACTURAS_MOCK];
}

export function getFacturas(clienteId?: number): Factura[] {
  const base = getFacturasBase();
  return clienteId != null ? base.filter((f) => f.cliente_id === clienteId) : base;
}

// ─── Tipificaciones ───────────────────────────────────────────────────────────

function getTipificacionesBase(): Tipificacion[] {
  const stored = safeGet<Tipificacion[]>(KEY_TIPIFICACIONES, []);
  return stored.length > 0 ? stored : [...TIPIFICACIONES_MOCK];
}

export function getTipificaciones(clienteId?: number): Tipificacion[] {
  const base = getTipificacionesBase();
  return clienteId != null ? base.filter((t) => t.cliente_id === clienteId) : base;
}

export interface NuevaTipificacion {
  cliente_id:   number;
  usuario:      string;
  tipo_gestion: TipoGestion;
  resultado:    ResultadoTipificacion;
  observacion:  string;
}

export function saveTipificacion(datos: NuevaTipificacion): Tipificacion {
  const base   = getTipificacionesBase();
  const nueva: Tipificacion = {
    id:    Date.now(),
    fecha: new Date().toISOString(),
    ...datos,
  };
  safeSet(KEY_TIPIFICACIONES, [...base, nueva]);
  return nueva;
}
