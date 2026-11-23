import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  getRecetaCoberturaMatriz,
  listPresentacionesDeProducto,
  listProductos,
  listProductosMenu,
  listProductosVendiblesSinReceta,
} from "@/lib/recetas/recetas-pg";

/**
 * Productos para el módulo Recetas.
 * ?filtro=vendibles-sin-receta  → vendibles sin receta base activa (compat legacy)
 * ?filtro=vendibles-menu        → Fase 2.2: TODOS los vendibles de menú (para recetas por presentación)
 * ?filtro=cobertura             → Fase 2.2: matriz producto × presentación → tiene receta
 * ?producto_id=XXX              → Fase 2.2: lista las presentaciones activas del producto
 * ?filtro=vendibles | insumos | todos
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const url = new URL(request.url);
    const filtro = url.searchParams.get("filtro") ?? "todos";
    const productoId = url.searchParams.get("producto_id");

    if (productoId) {
      const rows = await listPresentacionesDeProducto(ctx.supabase, ctx.auth.empresa_id, productoId);
      return NextResponse.json(successResponse({ presentaciones: rows }));
    }

    if (filtro === "cobertura") {
      const matriz = await getRecetaCoberturaMatriz(ctx.supabase, ctx.auth.empresa_id);
      return NextResponse.json(successResponse({ cobertura: matriz }));
    }
    if (filtro === "vendibles-menu") {
      const rows = await listProductosMenu(ctx.supabase, ctx.auth.empresa_id);
      return NextResponse.json(successResponse({ productos: rows }));
    }
    if (filtro === "vendibles-sin-receta") {
      const rows = await listProductosVendiblesSinReceta(ctx.supabase, ctx.auth.empresa_id);
      return NextResponse.json(successResponse({ productos: rows }));
    }
    const f = filtro === "vendibles" || filtro === "insumos" ? filtro : "todos";
    const rows = await listProductos(ctx.supabase, ctx.auth.empresa_id, f);
    return NextResponse.json(successResponse({ productos: rows }));
  } catch (err) {
    console.error("[/api/recetas/productos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar productos."), { status: 500 });
  }
}
