import type {
  AmbienteSifen,
  EmpresaSifenConfigCreateBody,
  EmpresaSifenConfigCreateResult,
  EmpresaSifenConfigPatchResult,
  SifenCertificadoPasswordPatchAction,
} from "./types";

function trimStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

export function parseAmbiente(v: unknown): AmbienteSifen | null {
  const s = trimStr(v);
  if (s === "test" || s === "produccion") return s;
  return null;
}

type PasswordWire =
  | { kind: "omit" }
  | { kind: "clear" }
  | { kind: "set"; value: string }
  | { kind: "error"; message: string };

function parseCertificadoPasswordWire(b: Record<string, unknown>): PasswordWire {
  if (!("certificado_password" in b)) return { kind: "omit" };
  if (b.certificado_password === null) return { kind: "clear" };
  const s = String(b.certificado_password);
  if (s === "") {
    return {
      kind: "error",
      message:
        "certificado_password no puede ser una cadena vacía; omita el campo o use null para borrar el secreto guardado",
    };
  }
  return { kind: "set", value: s };
}

/** Valida y normaliza el body de creación (POST). */
export function validateCreateBody(raw: unknown): EmpresaSifenConfigCreateResult {
  if (raw == null || typeof raw !== "object") {
    return { ok: false, error: "El cuerpo debe ser un objeto JSON" };
  }
  const b = raw as Record<string, unknown>;

  const ambiente = parseAmbiente(b.ambiente);
  if (!ambiente) {
    return {
      ok: false,
      error: "ambiente es obligatorio y debe ser 'test' o 'produccion'",
    };
  }

  const ruc = trimStr(b.ruc);
  const razon_social = trimStr(b.razon_social);
  const timbrado_numero = trimStr(b.timbrado_numero);
  const establecimiento = trimStr(b.establecimiento);
  const punto_expedicion = trimStr(b.punto_expedicion);

  if (!ruc) return { ok: false, error: "ruc es obligatorio" };
  if (!razon_social) return { ok: false, error: "razon_social es obligatoria" };
  if (!timbrado_numero) return { ok: false, error: "timbrado_numero es obligatorio" };
  if (!establecimiento) return { ok: false, error: "establecimiento es obligatorio" };
  if (!punto_expedicion) return { ok: false, error: "punto_expedicion es obligatorio" };

  const pw = parseCertificadoPasswordWire(b);
  if (pw.kind === "error") return { ok: false, error: pw.message };

  let certificado_password: string | null | undefined;
  if (pw.kind === "omit") certificado_password = undefined;
  else if (pw.kind === "clear") certificado_password = null;
  else certificado_password = pw.value;

  let certificado_vencimiento = optionalNullableString(b.certificado_vencimiento);
  if (certificado_vencimiento != null && certificado_vencimiento !== "") {
    const d = new Date(certificado_vencimiento);
    if (Number.isNaN(d.getTime())) {
      return { ok: false, error: "certificado_vencimiento no es una fecha válida (ISO 8601)" };
    }
    certificado_vencimiento = d.toISOString();
  }

  const data: EmpresaSifenConfigCreateBody = {
    ruc,
    razon_social,
    timbrado_numero,
    establecimiento,
    punto_expedicion,
    ambiente,
    csc: optionalNullableString(b.csc),
    certificado_path: optionalNullableString(b.certificado_path),
    certificado_password,
    certificado_vencimiento,
    activo: typeof b.activo === "boolean" ? b.activo : undefined,
  };

  return { ok: true, data };
}

function optionalNullableString(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Construye objeto de actualización para Supabase (PATCH), sin contraseña en claro. */
export function buildPatchUpdate(raw: unknown): EmpresaSifenConfigPatchResult {
  if (raw == null || typeof raw !== "object") {
    return { ok: false, error: "El cuerpo debe ser un objeto JSON" };
  }
  const b = raw as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  const pw = parseCertificadoPasswordWire(b);
  if (pw.kind === "error") return { ok: false, error: pw.message };

  const password: SifenCertificadoPasswordPatchAction =
    pw.kind === "omit"
      ? { kind: "omit" }
      : pw.kind === "clear"
        ? { kind: "clear" }
        : { kind: "set", value: pw.value };

  if ("ruc" in b) {
    const v = trimStr(b.ruc);
    if (!v) return { ok: false, error: "ruc no puede quedar vacío" };
    patch.ruc = v;
  }
  if ("razon_social" in b) {
    const v = trimStr(b.razon_social);
    if (!v) return { ok: false, error: "razon_social no puede quedar vacía" };
    patch.razon_social = v;
  }
  if ("timbrado_numero" in b) {
    const v = trimStr(b.timbrado_numero);
    if (!v) return { ok: false, error: "timbrado_numero no puede quedar vacío" };
    patch.timbrado_numero = v;
  }
  if ("establecimiento" in b) {
    const v = trimStr(b.establecimiento);
    if (!v) return { ok: false, error: "establecimiento no puede quedar vacío" };
    patch.establecimiento = v;
  }
  if ("punto_expedicion" in b) {
    const v = trimStr(b.punto_expedicion);
    if (!v) return { ok: false, error: "punto_expedicion no puede quedar vacío" };
    patch.punto_expedicion = v;
  }
  if ("ambiente" in b) {
    const a = parseAmbiente(b.ambiente);
    if (!a) return { ok: false, error: "ambiente debe ser 'test' o 'produccion'" };
    patch.ambiente = a;
  }
  if ("csc" in b) patch.csc = b.csc === null ? null : trimStr(b.csc) || null;
  if ("certificado_path" in b) {
    patch.certificado_path = b.certificado_path === null ? null : trimStr(b.certificado_path) || null;
  }
  if ("certificado_vencimiento" in b) {
    if (b.certificado_vencimiento === null || b.certificado_vencimiento === "") {
      patch.certificado_vencimiento = null;
    } else {
      const s = String(b.certificado_vencimiento).trim();
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) {
        return { ok: false, error: "certificado_vencimiento no es una fecha válida (ISO 8601)" };
      }
      patch.certificado_vencimiento = d.toISOString();
    }
  }
  if ("activo" in b) {
    if (typeof b.activo !== "boolean") {
      return { ok: false, error: "activo debe ser booleano" };
    }
    patch.activo = b.activo;
  }

  if (Object.keys(patch).length === 0 && password.kind === "omit") {
    return { ok: false, error: "No se envió ningún campo para actualizar" };
  }

  return { ok: true, patch, password };
}

/** Fila insert sin contraseña en claro (la API cifra y asigna certificado_password_encrypted). */
export function rowFromCreateBody(empresaId: string, body: EmpresaSifenConfigCreateBody): Record<string, unknown> {
  const row: Record<string, unknown> = {
    empresa_id: empresaId,
    ambiente: body.ambiente,
    ruc: body.ruc,
    razon_social: body.razon_social,
    timbrado_numero: body.timbrado_numero,
    establecimiento: body.establecimiento,
    punto_expedicion: body.punto_expedicion,
    csc: body.csc ?? null,
    certificado_path: body.certificado_path ?? null,
    activo: body.activo ?? true,
  };
  if (body.certificado_vencimiento != null) {
    row.certificado_vencimiento = body.certificado_vencimiento;
  }
  return row;
}
