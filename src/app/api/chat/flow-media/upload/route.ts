import { NextRequest, NextResponse } from "next/server";
import { getAuthWithRol } from "@/lib/middleware/auth";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { validateUploadMime } from "@/lib/security/file-magic-bytes";

// MIMEs aceptados: imágenes web comunes. Mantener acá para que detectMime
// pueda hacer el cross-check.
const ALLOWED_FLOW_MEDIA_MIME: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_FLOW_MEDIA_BYTES = 10 * 1024 * 1024; // 10 MB

const CHAT_MEDIA_BUCKET = "chat-media";

async function ensureBucket(supabase: AppSupabaseClient) {
  const { data, error } = await supabase.storage.listBuckets();
  if (error) throw new Error(error.message);
  const exists = (data ?? []).some((b) => b.name === CHAT_MEDIA_BUCKET);
  if (exists) return;
  const { error: createErr } = await supabase.storage.createBucket(CHAT_MEDIA_BUCKET, {
    public: true,
    fileSizeLimit: "10MB",
  });
  if (createErr && !createErr.message.toLowerCase().includes("already exists")) {
    throw new Error(createErr.message);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Archivo requerido" }, { status: 400 });
    }
    if (!ALLOWED_FLOW_MEDIA_MIME.has(file.type)) {
      return NextResponse.json({ ok: false, error: "Solo se permiten imágenes (JPG, PNG, WebP, GIF)" }, { status: 400 });
    }
    if (file.size > MAX_FLOW_MEDIA_BYTES) {
      return NextResponse.json({ ok: false, error: "Imagen demasiado grande (máx. 10 MB)" }, { status: 413 });
    }
    // Validar magic bytes — el MIME del cliente no es fuente de verdad.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const realMime = validateUploadMime(bytes, ALLOWED_FLOW_MEDIA_MIME, file.type);
    if (!realMime) {
      return NextResponse.json(
        { ok: false, error: "El contenido del archivo no coincide con el tipo declarado." },
        { status: 400 },
      );
    }
    // Extension derivada del MIME real (jpeg|png|webp|gif), no del filename.
    const ext = realMime.split("/")[1] === "jpeg" ? "jpg" : realMime.split("/")[1];
    const path = `${auth.empresa_id}/flow-editor/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const supabase = await getChatServiceClientForEmpresa(auth.empresa_id);
    await ensureBucket(supabase);
    const up = await supabase.storage.from(CHAT_MEDIA_BUCKET).upload(path, bytes, {
      contentType: realMime,
      upsert: true,
    });
    if (up.error) {
      return NextResponse.json({ ok: false, error: up.error.message }, { status: 400 });
    }
    const mediaUrl = supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
    return NextResponse.json({ ok: true, media_url: mediaUrl, path });
  } catch (e) {
    console.error("[api/chat/flow-media/upload][POST]", e);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
