export type TipoGestion =
  | "Consulta"
  | "Reclamo"
  | "Seguimiento"
  | "Promesa de pago"
  | "Soporte técnico"
  | "Cambio plan";

export type ResultadoTipificacion = "Pendiente" | "Resuelto" | "Escalar";

export interface Tipificacion {
  id:           number;
  cliente_id:   number;
  fecha:        string;               // ISO string
  usuario:      string;
  tipo_gestion: TipoGestion;
  resultado:    ResultadoTipificacion;
  observacion:  string;
}

export type EstadoFactura = "Pagado" | "Pendiente" | "Vencido" | "Anulado";

export interface Factura {
  id:                number;
  cliente_id:        number;
  numero_factura:    string;
  fecha:             string;          // YYYY-MM-DD
  fecha_vencimiento: string;          // YYYY-MM-DD
  monto:             number;
  saldo:             number;
  estado:            EstadoFactura;
  tipo:              "contado" | "credito" | "suscripcion";
  moneda:            "GS" | "USD";
}
