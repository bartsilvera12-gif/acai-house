/**
 * Detección de tipo de archivo por **magic bytes** (firma binaria real),
 * no por el header MIME que manda el cliente (el cual es trivialmente
 * falsificable).
 *
 * Cubre los formatos que aceptamos en uploads:
 *   - image/jpeg, image/png, image/webp, image/gif
 *   - application/pdf
 *
 * Usar para comparar el resultado contra el MIME declarado por el cliente:
 *   const real = detectMimeFromBytes(buffer);
 *   if (!real || real !== file.type) → rechazar.
 */

export type DetectedMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif"
  | "application/pdf"
  | null;

/**
 * Devuelve el MIME real detectado o null si no matchea ninguno conocido.
 * Lee los primeros 12 bytes (suficiente para los formatos soportados).
 */
export function detectMimeFromBytes(input: ArrayBufferLike | Uint8Array | Buffer): DetectedMime {
  const u8 =
    input instanceof Uint8Array
      ? input
      : new Uint8Array(input as ArrayBufferLike);
  if (u8.length < 4) return null;

  // JPEG: FF D8 FF
  if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return "image/jpeg";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    u8[0] === 0x89 &&
    u8[1] === 0x50 &&
    u8[2] === 0x4e &&
    u8[3] === 0x47 &&
    u8.length >= 8 &&
    u8[4] === 0x0d &&
    u8[5] === 0x0a &&
    u8[6] === 0x1a &&
    u8[7] === 0x0a
  ) {
    return "image/png";
  }

  // GIF: GIF87a o GIF89a → 47 49 46 38
  if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x38) {
    return "image/gif";
  }

  // WebP: RIFF???? WEBP — bytes 0-3 "RIFF" + bytes 8-11 "WEBP"
  if (
    u8.length >= 12 &&
    u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 &&
    u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50
  ) {
    return "image/webp";
  }

  // PDF: %PDF-
  if (u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46) {
    return "application/pdf";
  }

  return null;
}

/**
 * Helper combinado: valida que el contenido real coincida con un MIME
 * permitido y con el declarado. Devuelve el MIME detectado o null si
 * debe rechazarse.
 *
 * @param bytes    Buffer del archivo subido.
 * @param allowed  Set de MIMEs aceptados por el endpoint.
 * @param declared MIME que dijo el cliente (opcional; si difiere, se rechaza).
 */
export function validateUploadMime(
  bytes: ArrayBufferLike | Uint8Array | Buffer,
  allowed: ReadonlySet<string>,
  declared?: string | null,
): DetectedMime {
  const real = detectMimeFromBytes(bytes);
  if (!real) return null;
  if (!allowed.has(real)) return null;
  if (declared && declared.trim() !== "" && declared !== real) return null;
  return real;
}
