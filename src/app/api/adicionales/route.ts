import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * Catálogo global de adicionales (toppings / extras).
 * GET  → todos los adicionales de la empresa.
 * POST → crea un adicional (nombre + precio).
 */

const COLS = "id, empresa_id, nombre, precio, orden, activo, created_at, updated_at";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const url = new URL(request.url);
    const soloActivos = url.searchParams.get("todos") !== "1";

    let q = ctx.supabase
      .from("adicionales")
      .select(COLS)
      .eq("empresa_id", ctx.auth.empresa_id)
      .order("orden")
      .order("nombre");
    if (soloActivos) q = q.eq("activo", true);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ adicionales: data ?? [] }));
  } catch (err) {
    console.error("[/api/adicionales GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los adicionales."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
    if (!nombre) return NextResponse.json(errorResponse("El nombre es obligatorio."), { status: 400 });

    const precio = Number(body.precio);
    if (!Number.isFinite(precio) || precio < 0) {
      return NextResponse.json(errorResponse("El precio debe ser un número ≥ 0."), { status: 400 });
    }
    const orden = Number.isFinite(Number(body.orden)) ? Number(body.orden) : 0;
    const activo = body.activo === false ? false : true;

    const ins = await ctx.supabase
      .from("adicionales")
      .insert({ empresa_id: ctx.auth.empresa_id, nombre, precio, orden, activo })
      .select(COLS)
      .single();

    if (ins.error) {
      const msg = ins.error.message ?? "";
      if (/duplicate key|unique|23505/i.test(msg)) {
        return NextResponse.json(errorResponse("Ya existe un adicional con ese nombre."), { status: 409 });
      }
      console.error("[/api/adicionales POST]", msg);
      return NextResponse.json(errorResponse("No se pudo crear el adicional."), { status: 500 });
    }

    return NextResponse.json(successResponse({ adicional: ins.data }));
  } catch (err) {
    console.error("[/api/adicionales POST] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo crear el adicional."), { status: 500 });
  }
}
