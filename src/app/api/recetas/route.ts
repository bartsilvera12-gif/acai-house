import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { insertReceta, listRecetas } from "@/lib/recetas/recetas-pg";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const rows = await listRecetas(ctx.supabase, ctx.auth.empresa_id);
    return NextResponse.json(successResponse({ recetas: rows }));
  } catch (err) {
    console.error("[/api/recetas GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las recetas."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const producto_id = typeof body.producto_id === "string" ? body.producto_id : null;
    if (!producto_id) {
      return NextResponse.json(errorResponse("producto_id es obligatorio."), { status: 400 });
    }
    // Fase 2.2: presentacion_id opcional. NULL = receta base del producto.
    const presentacion_id =
      typeof body.presentacion_id === "string" && body.presentacion_id.length > 0
        ? body.presentacion_id
        : null;

    // Defensa en profundidad: si el producto tiene presentaciones ACTIVAS, no se permite
    // crear una receta base (presentacion_id = NULL) desde la API. Debe elegirse una
    // presentación. Esto refuerza la validación del UI y previene bypass por API.
    if (presentacion_id === null) {
      const pq = await ctx.supabase
        .from("producto_presentaciones")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("producto_id", producto_id)
        .eq("activo", true);
      if (pq.error) throw new Error(pq.error.message);
      const total = pq.count ?? 0;
      if (total > 0) {
        return NextResponse.json(
          errorResponse("Este producto tiene presentaciones configuradas. Elegí una presentación: no se permite crear una receta base genérica."),
          { status: 400 },
        );
      }
    }

    const row = await insertReceta(ctx.supabase, ctx.auth.empresa_id, {
      producto_id,
      presentacion_id,
      nombre: typeof body.nombre === "string" ? body.nombre : null,
      rendimiento_cantidad:
        typeof body.rendimiento_cantidad === "number" ? body.rendimiento_cantidad : 1,
      rendimiento_unidad:
        typeof body.rendimiento_unidad === "string" ? body.rendimiento_unidad : null,
      notas: typeof body.notas === "string" ? body.notas : null,
      activa: body.activa === false ? false : true,
    });
    return NextResponse.json(successResponse({ receta: row }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/recetas_activa_producto_presentacion_uq|recetas_empresa_producto_uq|duplicate|23505/i.test(msg)) {
      return NextResponse.json(
        errorResponse("Ya existe una receta activa para esa combinación de producto y presentación."),
        { status: 409 }
      );
    }
    if (/presentación.*no pertenece|Presentación .* no existe/i.test(msg)) {
      return NextResponse.json(
        errorResponse("La presentación seleccionada no pertenece al producto o la empresa."),
        { status: 400 }
      );
    }
    console.error("[/api/recetas POST]", msg);
    return NextResponse.json(errorResponse("No se pudo crear la receta."), { status: 500 });
  }
}
