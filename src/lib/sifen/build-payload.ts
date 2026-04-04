import type {
  EstadoSifen,
  SifenFacturaPayloadBase,
  SifenPayloadDocumento,
  SifenPayloadEmisor,
  SifenPayloadItem,
  SifenPayloadMeta,
  SifenPayloadReceptor,
} from "./types";

function trimStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export interface SifenBuildFacturaRow {
  id: string;
  cliente_id: string;
  numero_factura: string;
  fecha: string;
  tipo: string;
  moneda: string;
  monto: unknown;
  saldo: unknown;
}

export interface SifenBuildItemRow {
  descripcion: string;
  cantidad: unknown;
  precio_unitario: unknown;
  subtotal: unknown;
  iva: unknown;
  total: unknown;
}

export interface SifenBuildClienteRow {
  id: string;
  empresa: string | null;
  nombre_contacto: string | null;
  nombre: string | null;
  ruc: string | null;
  documento: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
}

export interface SifenBuildConfigRow {
  ruc: string;
  razon_social: string;
  timbrado_numero: string;
  establecimiento: string;
  punto_expedicion: string;
  activo: boolean;
}

export interface SifenBuildElectronicaRow {
  id: string;
  estado_sifen: EstadoSifen;
}

export interface BuildSifenPayloadInput {
  factura: SifenBuildFacturaRow;
  items: SifenBuildItemRow[];
  cliente: SifenBuildClienteRow | null;
  config: SifenBuildConfigRow | null;
  facturaElectronica: SifenBuildElectronicaRow | null;
}

export type BuildSifenPayloadResult =
  | { ok: true; payload: SifenFacturaPayloadBase }
  | { ok: false; error: string };

function nombreReceptor(c: SifenBuildClienteRow): string {
  return trimStr(c.empresa) || trimStr(c.nombre_contacto) || trimStr(c.nombre);
}

function validateEmisor(config: SifenBuildConfigRow | null): { ok: true; emisor: SifenPayloadEmisor } | { ok: false; error: string } {
  if (!config) {
    return {
      ok: false,
      error:
        "No hay configuración SIFEN para esta empresa. Cree la configuración en /api/configuracion/sifen.",
    };
  }
  if (!config.activo) {
    return {
      ok: false,
      error:
        "La configuración SIFEN está desactivada. Actívela en /api/configuracion/sifen antes de obtener el payload.",
    };
  }
  const ruc = trimStr(config.ruc);
  const razon_social = trimStr(config.razon_social);
  const timbrado_numero = trimStr(config.timbrado_numero);
  const establecimiento = trimStr(config.establecimiento);
  const punto_expedicion = trimStr(config.punto_expedicion);
  const faltas: string[] = [];
  if (!ruc) faltas.push("empresa_sifen_config.ruc");
  if (!razon_social) faltas.push("empresa_sifen_config.razon_social");
  if (!timbrado_numero) faltas.push("empresa_sifen_config.timbrado_numero");
  if (!establecimiento) faltas.push("empresa_sifen_config.establecimiento");
  if (!punto_expedicion) faltas.push("empresa_sifen_config.punto_expedicion");
  if (faltas.length > 0) {
    return {
      ok: false,
      error: `Faltan datos del emisor en configuración SIFEN: ${faltas.join(", ")}.`,
    };
  }
  return {
    ok: true,
    emisor: { ruc, razon_social, timbrado_numero, establecimiento, punto_expedicion },
  };
}

function validateReceptor(
  factura: SifenBuildFacturaRow,
  cliente: SifenBuildClienteRow | null
): { ok: true; receptor: SifenPayloadReceptor } | { ok: false; error: string } {
  if (!cliente) {
    return {
      ok: false,
      error: "No se encontró el cliente asociado a la factura (cliente_id inválido o sin acceso).",
    };
  }
  if (trimStr(cliente.id) !== trimStr(factura.cliente_id)) {
    return { ok: false, error: "El cliente cargado no coincide con cliente_id de la factura." };
  }
  const nombre = nombreReceptor(cliente);
  if (!nombre) {
    return {
      ok: false,
      error:
        "Falta el nombre del receptor: complete en el cliente al menos uno de: empresa, nombre_contacto o nombre.",
    };
  }
  const ruc = trimStr(cliente.ruc) || null;
  const documento = trimStr(cliente.documento) || null;
  if (!ruc && !documento) {
    return {
      ok: false,
      error:
        "Falta identificación del receptor: complete en el cliente al menos ruc o documento.",
    };
  }
  const receptor: SifenPayloadReceptor = {
    cliente_id: cliente.id,
    nombre,
    documento,
    ruc,
    direccion: trimStr(cliente.direccion) || null,
    telefono: trimStr(cliente.telefono) || null,
    email: trimStr(cliente.email) || null,
  };
  return { ok: true, receptor };
}

function mapItems(rows: SifenBuildItemRow[]): SifenPayloadItem[] {
  return rows.map((r) => ({
    descripcion: trimStr(r.descripcion) || "(sin descripción)",
    cantidad: num(r.cantidad),
    precio_unitario: num(r.precio_unitario),
    subtotal: num(r.subtotal),
    iva: num(r.iva),
    total: num(r.total),
  }));
}

/**
 * Valida datos mínimos y arma el payload base SIFEN (sin XML).
 */
export function validateAndBuildSifenPayload(input: BuildSifenPayloadInput): BuildSifenPayloadResult {
  const { factura, items, cliente, config, facturaElectronica } = input;

  if (!facturaElectronica) {
    return {
      ok: false,
      error:
        "No existe borrador electrónico para esta factura. Genérelo primero con POST /api/facturas/{id}/sifen/borrador.",
    };
  }

  const em = validateEmisor(config);
  if (!em.ok) return em;

  const rec = validateReceptor(factura, cliente);
  if (!rec.ok) return rec;

  if (!items.length) {
    return {
      ok: false,
      error:
        "La factura no tiene líneas en factura_items. Agregue ítems antes de construir el payload SIFEN.",
    };
  }

  const documento: SifenPayloadDocumento = {
    factura_id: factura.id,
    numero_factura: trimStr(factura.numero_factura),
    fecha: trimStr(factura.fecha),
    tipo: trimStr(factura.tipo),
    moneda: trimStr(factura.moneda) || "GS",
    monto: num(factura.monto),
    saldo: num(factura.saldo),
  };

  if (!documento.numero_factura) {
    return { ok: false, error: "La factura no tiene numero_factura." };
  }
  if (!documento.fecha) {
    return { ok: false, error: "La factura no tiene fecha." };
  }
  if (!documento.tipo) {
    return { ok: false, error: "La factura no tiene tipo." };
  }

  const sifen: SifenPayloadMeta = {
    factura_electronica_id: facturaElectronica.id,
    estado_sifen: facturaElectronica.estado_sifen,
  };

  const payload: SifenFacturaPayloadBase = {
    emisor: em.emisor,
    documento,
    receptor: rec.receptor,
    items: mapItems(items),
    sifen,
  };

  return { ok: true, payload };
}
