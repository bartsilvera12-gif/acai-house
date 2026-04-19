import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import type { ProveedorCategoria } from "@/lib/proveedores/types";

function mapCat(r: Record<string, unknown>): ProveedorCategoria {
  return {
    id: r.id as string,
    empresa_id: r.empresa_id as string | undefined,
    nombre: (r.nombre as string) ?? "",
    descripcion: (r.descripcion as string) ?? null,
    activo: r.activo !== false,
    created_at: r.created_at != null ? String(r.created_at) : undefined,
    updated_at: r.updated_at != null ? String(r.updated_at) : undefined,
  };
}

/**
 * PATCH /api/proveedores/categorias/[id]
 */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const tenant = await getTenantSupabaseFromAuth(request);
    if (!tenant) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { supabase, auth } = tenant;
    const empresaId = auth.empresa_id;
    const { id } = await ctx.params;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    if (body.nombre !== undefined) {
      const n = String(body.nombre).trim();
      if (!n) {
        return NextResponse.json(errorResponse("El nombre no puede quedar vacío."), { status: 400 });
      }
      patch.nombre = n;
    }
    if (body.descripcion !== undefined) {
      patch.descripcion = body.descripcion != null ? String(body.descripcion).trim() || null : null;
    }
    if (body.activo !== undefined) {
      patch.activo = Boolean(body.activo);
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(errorResponse("Sin cambios."), { status: 400 });
    }

    const { data: updated, error } = await supabase
      .from("proveedor_categorias")
      .update(patch)
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .select("*")
      .maybeSingle();

    if (error) {
      const status = error.message.toLowerCase().includes("unique") ? 409 : 500;
      return NextResponse.json(errorResponse(error.message), { status });
    }
    if (!updated) {
      return NextResponse.json(errorResponse("Categoría no encontrada."), { status: 404 });
    }

    return NextResponse.json(successResponse({ categoria: mapCat(updated as Record<string, unknown>) }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
