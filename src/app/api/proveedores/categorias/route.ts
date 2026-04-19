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
 * GET /api/proveedores/categorias
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { supabase, auth } = ctx;
    const incluirInactivas = request.nextUrl.searchParams.get("todas") === "1";

    let q = supabase
      .from("proveedor_categorias")
      .select("*")
      .eq("empresa_id", auth.empresa_id)
      .order("nombre");
    if (!incluirInactivas) {
      q = q.eq("activo", true);
    }

    const { data, error } = await q;
    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 500 });
    }

    const categorias = (data ?? []).map((row) => mapCat(row as Record<string, unknown>));
    return NextResponse.json(successResponse({ categorias }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * POST /api/proveedores/categorias
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { supabase, auth } = ctx;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const nombre = String(body.nombre ?? "").trim();
    if (!nombre) {
      return NextResponse.json(errorResponse("El nombre es obligatorio."), { status: 400 });
    }

    const insert = {
      empresa_id: auth.empresa_id,
      nombre,
      descripcion: body.descripcion != null ? String(body.descripcion).trim() || null : null,
      activo: body.activo === false ? false : true,
    };

    const { data: created, error } = await supabase
      .from("proveedor_categorias")
      .insert([insert])
      .select("*")
      .single();

    if (error || !created) {
      const msg = error?.message ?? "No se pudo crear la categoría.";
      const status = msg.toLowerCase().includes("unique") ? 409 : 500;
      return NextResponse.json(errorResponse(msg), { status });
    }

    return NextResponse.json(successResponse({ categoria: mapCat(created as Record<string, unknown>) }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
