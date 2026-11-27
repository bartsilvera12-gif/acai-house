import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { crearGrupo, listGruposDeReceta } from "@/lib/recetas/grupos-variante-pg";

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const t = await getTenantSupabaseFromAuth(request);
    if (!t) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const grupos = await listGruposDeReceta(t.supabase, t.auth.empresa_id, id);
    return NextResponse.json(successResponse({ grupos }));
  } catch (err) {
    console.error("[/api/recetas/[id]/grupos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los grupos."), { status: 500 });
  }
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const t = await getTenantSupabaseFromAuth(request);
    if (!t) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const grupo = await crearGrupo(t.supabase, t.auth.empresa_id, id, {
      codigo: String(body.codigo ?? ""),
      etiqueta: String(body.etiqueta ?? ""),
      obligatorio: body.obligatorio === false ? false : true,
      orden: typeof body.orden === "number" ? body.orden : 0,
    });
    return NextResponse.json(successResponse({ grupo }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = /inválid|obligatori|existe|ERRCODE|23\d{3}|duplicate|unique/i.test(msg) ? 400 : 500;
    return NextResponse.json(errorResponse(msg), { status });
  }
}
