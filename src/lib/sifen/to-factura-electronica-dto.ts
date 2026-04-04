import type { EstadoSifen, FacturaElectronicaDTO } from "./types";

/** Mapea fila BD → DTO público (mismas columnas que expone la API SIFEN). */
export function toFacturaElectronicaDto(row: Record<string, unknown>): FacturaElectronicaDTO {
  return {
    id: String(row.id),
    empresa_id: String(row.empresa_id),
    factura_id: String(row.factura_id),
    estado_sifen: row.estado_sifen as EstadoSifen,
    cdc: row.cdc == null ? null : String(row.cdc),
    xml_path: row.xml_path == null ? null : String(row.xml_path),
    xml_firmado_path: row.xml_firmado_path == null ? null : String(row.xml_firmado_path),
    kuDE_url: row.kuDE_url == null ? null : String(row.kuDE_url),
    qr_data: row.qr_data == null ? null : String(row.qr_data),
    error: row.error == null ? null : String(row.error),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}
