import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { deleteGrupo, updateGrupo } from "@/lib/recetas/grupos-variante-pg";

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string; gid: string }> }) {
  try {
    const { gid } = await ctx.params;
    const t = await getTenantSupabaseFromAuth(request);
    if (!t) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const grupo = await updateGrupo(t.supabase, t.auth.empresa_id, gid, {
      etiqueta: typeof body.etiqueta === "string" ? body.etiqueta : undefined,
      obligatorio: typeof body.obligatorio === "boolean" ? body.obligatorio : undefined,
      orden: typeof body.orden === "number" ? body.orden : undefined,
    });
    return NextResponse.json(successResponse({ grupo }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = /inválid|caracteres|rango/i.test(msg) ? 400 : 500;
    return NextResponse.json(errorResponse(msg), { status });
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string; gid: string }> }) {
  try {
    const { gid } = await ctx.params;
    const t = await getTenantSupabaseFromAuth(request);
    if (!t) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    await deleteGrupo(t.supabase, t.auth.empresa_id, gid);
    return NextResponse.json(successResponse({ deleted: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
