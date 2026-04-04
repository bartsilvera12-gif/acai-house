import type { AmbienteSifen, EmpresaSifenConfigDTO } from "./types";

/**
 * Convierte una fila de BD (con columna cifrada) al DTO expuesto por la API.
 * Nunca incluye la contraseña ni el ciphertext.
 */
export function toEmpresaSifenConfigPublicDto(
  row: Record<string, unknown> | null
): EmpresaSifenConfigDTO | null {
  if (!row) return null;

  const enc = row.certificado_password_encrypted;
  const legacyPlain = row.certificado_password;
  const has_enc = enc != null && String(enc).trim().length > 0;
  const has_plain =
    legacyPlain != null && String(legacyPlain).trim().length > 0;
  const has_certificado_password = has_enc || has_plain;

  return {
    id: String(row.id),
    empresa_id: String(row.empresa_id),
    ambiente: row.ambiente as AmbienteSifen,
    ruc: String(row.ruc ?? ""),
    razon_social: String(row.razon_social ?? ""),
    timbrado_numero: String(row.timbrado_numero ?? ""),
    establecimiento: String(row.establecimiento ?? ""),
    punto_expedicion: String(row.punto_expedicion ?? ""),
    csc: row.csc == null ? null : String(row.csc),
    certificado_path: row.certificado_path == null ? null : String(row.certificado_path),
    certificado_vencimiento:
      row.certificado_vencimiento == null ? null : String(row.certificado_vencimiento),
    activo: Boolean(row.activo),
    has_certificado_password,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}
