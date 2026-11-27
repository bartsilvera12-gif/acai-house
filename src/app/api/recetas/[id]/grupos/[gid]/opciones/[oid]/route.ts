import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { deleteOpcion, updateOpcion } from "@/lib/recetas/grupos-variante-pg";

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string; gid: string; oid: string }> }) {
  try {
    const { oid } = await ctx.params;
    const t = await getTenantSupabaseFromAuth(request);
    if (!t) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const opcion = await updateOpcion(t.supabase, t.auth.empresa_id, oid, {
      cantidad: typeof body.cantidad === "number" ? body.cantidad : undefined,
      unidad_medida: typeof body.unidad_medida === "string" ? body.unidad_medida : undefined,
      merma_pct: typeof body.merma_pct === "number" ? body.merma_pct : undefined,
      etiqueta: typeof body.etiqueta === "string" ? body.etiqueta : undefined,
      orden: typeof body.orden === "number" ? body.orden : undefined,
    });
    return NextResponse.json(successResponse({ opcion }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = /inválid|cantidad|merma|caracteres/i.test(msg) ? 400 : 500;
    return NextResponse.json(errorResponse(msg), { status });
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string; gid: string; oid: string }> }) {
  try {
    const { oid } = await ctx.params;
    const t = await getTenantSupabaseFromAuth(request);
    if (!t) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    await deleteOpcion(t.supabase, t.auth.empresa_id, oid);
    return NextResponse.json(successResponse({ deleted: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
