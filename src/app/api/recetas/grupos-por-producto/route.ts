/**
 * Fase 2.2 Parte 4 — Grupos de variantes obligatorias por (producto, presentación).
 *
 * El POS consulta este endpoint al momento de agregar una línea para saber si
 * debe pedir al cajero elegir chocolate/Bis/Oreo. Devuelve solo los grupos
 * activos de la receta activa correspondiente a esa combinación.
 *
 * Query: ?producto_id=UUID&presentacion_id=UUID (presentacion_id opcional:
 * si NULL o ausente, busca la receta base sin presentación).
 */

import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { listGruposDeRecetas } from "@/lib/recetas/recetas-pg";

export async function GET(request: NextRequest) {
  try {
    const t = await getTenantSupabaseFromAuth(request);
    if (!t) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const url = new URL(request.url);
    const producto_id = url.searchParams.get("producto_id");
    const presentacion_id = url.searchParams.get("presentacion_id");
    if (!producto_id) {
      return NextResponse.json(errorResponse("producto_id es obligatorio."), { status: 400 });
    }
    // Buscar receta activa (producto_id, presentacion_id | null).
    let q = t.supabase
      .from("recetas")
      .select("id")
      .eq("empresa_id", t.auth.empresa_id)
      .eq("producto_id", producto_id)
      .eq("activa", true);
    q = presentacion_id ? q.eq("presentacion_id", presentacion_id) : q.is("presentacion_id", null);
    const { data: recetasFound, error: eR } = await q.limit(1);
    if (eR) throw new Error(eR.message);
    const recetaId = (recetasFound ?? [])[0]?.id ?? null;
    if (!recetaId) return NextResponse.json(successResponse({ grupos: [] }));
    const mapa = await listGruposDeRecetas(t.supabase, t.auth.empresa_id, [recetaId]);
    const grupos = mapa.get(recetaId) ?? [];
    return NextResponse.json(successResponse({ grupos }));
  } catch (err) {
    console.error("[/api/recetas/grupos-por-producto]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los grupos."), { status: 500 });
  }
}
