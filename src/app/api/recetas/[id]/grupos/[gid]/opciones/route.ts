import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { crearOpcion } from "@/lib/recetas/grupos-variante-pg";

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string; gid: string }> }) {
  try {
    const { gid } = await ctx.params;
    const t = await getTenantSupabaseFromAuth(request);
    if (!t) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const opcion = await crearOpcion(t.supabase, t.auth.empresa_id, gid, {
      insumo_producto_id: String(body.insumo_producto_id ?? ""),
      cantidad: Number(body.cantidad),
      unidad_medida: String(body.unidad_medida ?? ""),
      etiqueta: String(body.etiqueta ?? ""),
      merma_pct: typeof body.merma_pct === "number" ? body.merma_pct : 0,
      orden: typeof body.orden === "number" ? body.orden : 0,
    });
    return NextResponse.json(successResponse({ opcion }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = /inválid|obligatori|cantidad|merma|insumo|existe|ERRCODE|23\d{3}|duplicate|unique|es_insumo|inactiv/i.test(msg) ? 400 : 500;
    return NextResponse.json(errorResponse(msg), { status });
  }
}
