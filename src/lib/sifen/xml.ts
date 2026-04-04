import type {
  SifenDocumentoEmisor,
  SifenDocumentoIdentificacion,
  SifenDocumentoItemLinea,
  SifenDocumentoPreparado,
  SifenDocumentoReceptor,
  SifenDocumentoTotales,
} from "./types";

const XML_NS = "https://neura-erp.local/sifen/draft/v1";

/** Escapa texto para nodos y atributos XML. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function el(name: string, content: string): string {
  return `<${name}>${content}</${name}>`;
}

function textEl(name: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return `<${name}/>`;
  }
  return el(name, escapeXml(String(value)));
}

export function buildXmlIdentificacion(i: SifenDocumentoIdentificacion): string {
  return [
    "<Identificacion>",
    textEl("FacturaId", i.factura_id),
    textEl("NumeroFactura", i.numero_factura),
    textEl("FechaEmision", i.fecha_emision),
    textEl("Moneda", i.moneda),
    textEl("TipoDocumentoErp", i.tipo_documento_erp),
    textEl("SaldoFacturaErp", i.saldo_factura_erp),
    textEl("FacturaElectronicaId", i.factura_electronica_id),
    textEl("EstadoSifen", i.estado_sifen),
    "</Identificacion>",
  ].join("");
}

export function buildXmlEmisor(e: SifenDocumentoEmisor): string {
  return [
    "<Emisor>",
    textEl("Ruc", e.ruc),
    textEl("RazonSocial", e.razon_social),
    textEl("TimbradoNumero", e.timbrado_numero),
    textEl("Establecimiento", e.establecimiento),
    textEl("PuntoExpedicion", e.punto_expedicion),
    "</Emisor>",
  ].join("");
}

export function buildXmlReceptor(r: SifenDocumentoReceptor): string {
  return [
    "<Receptor>",
    textEl("ClienteId", r.cliente_id),
    textEl("RazonSocialONombre", r.razon_social_o_nombre),
    textEl("Ruc", r.ruc),
    textEl("Documento", r.documento),
    textEl("Direccion", r.direccion),
    textEl("Telefono", r.telefono),
    textEl("Email", r.email),
    "</Receptor>",
  ].join("");
}

export function buildXmlTotales(t: SifenDocumentoTotales): string {
  return [
    "<Totales>",
    textEl("TotalGeneral", t.total_general),
    textEl("TotalIva", t.total_iva),
    textEl("SubtotalItems", t.subtotal_items),
    textEl("MontoTotalErp", t.monto_total_erp),
    textEl("SaldoErp", t.saldo_erp),
    "</Totales>",
  ].join("");
}

export function buildXmlItemLinea(linea: SifenDocumentoItemLinea): string {
  return [
    "<Item>",
    textEl("NroLinea", linea.nro_linea),
    textEl("Descripcion", linea.descripcion),
    textEl("Cantidad", linea.cantidad),
    textEl("PrecioUnitario", linea.precio_unitario),
    textEl("Subtotal", linea.subtotal),
    textEl("Iva", linea.iva),
    textEl("TotalLinea", linea.total_linea),
    textEl("CodigoProducto", linea.codigo_producto),
    textEl("CodigoUnidadMedida", linea.codigo_unidad_medida),
    textEl("AfectacionIva", linea.afectacion_iva),
    "</Item>",
  ].join("");
}

export function buildXmlItems(items: SifenDocumentoItemLinea[]): string {
  return `<Items>${items.map((it) => buildXmlItemLinea(it)).join("")}</Items>`;
}

export function buildXmlExtensionFutura(doc: SifenDocumentoPreparado): string {
  const x = doc.extension_futura;
  return [
    "<ExtensionFutura>",
    textEl("Cdc", x.cdc),
    textEl("Firma", x.firma),
    textEl("Qr", x.qr),
    textEl("XmlFirmado", x.xml),
    "</ExtensionFutura>",
  ].join("");
}

/**
 * XML borrador alineado a SifenDocumentoPreparado (no es el esquema oficial SET final).
 * Listo para envolver en firma digital en un paso posterior.
 */
export function buildSifenDraftXml(doc: SifenDocumentoPreparado): string {
  const inner = [
    buildXmlIdentificacion(doc.identificacion),
    buildXmlEmisor(doc.emisor),
    buildXmlReceptor(doc.receptor),
    buildXmlTotales(doc.totales),
    buildXmlItems(doc.items),
    buildXmlExtensionFutura(doc),
  ].join("");

  const declaration = `<?xml version="1.0" encoding="UTF-8"?>`;
  const root = `<DocumentoElectronico xmlns="${XML_NS}" version="borrador-neura-1">${inner}</DocumentoElectronico>`;
  return `${declaration}\n${root}\n`;
}
