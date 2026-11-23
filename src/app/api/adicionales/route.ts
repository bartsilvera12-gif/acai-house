import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * Catálogo global de adicionales (toppings / extras).
 * GET  → todos los adicionales de la empresa.
 * POST → crea un adicional (nombre + precio).
 */

const COLS = "id, empresa_id, nombre, precio, orden, activo, insumo_producto_id, insumo_cantidad, insumo_unidad, created_at, updated_at";

/**
 * Normaliza un valor numérico opcional para `insumo_cantidad`. Devuelve null si
 * no es un número > 0, undefined si el campo no vino en el body (no cambia).
 */
function toPositiveNumberOrNull(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
function toStringOrNull(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

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

    // Fase 2.2: vínculo opcional con insumo físico (alternativa A).
    const insumoProductoId = toStringOrNull(body.insumo_producto_id);
    const insumoCantidad = toPositiveNumberOrNull(body.insumo_cantidad);
    const insumoUnidad = toStringOrNull(body.insumo_unidad);

    // Validación: si se vincula insumo, debe existir en la misma empresa y ser es_insumo=true.
    if (insumoProductoId) {
      const check = await ctx.supabase
        .from("productos")
        .select("id, es_insumo")
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("id", insumoProductoId)
        .maybeSingle();
      if (check.error) throw new Error(check.error.message);
      if (!check.data) {
        return NextResponse.json(errorResponse("El insumo indicado no existe."), { status: 400 });
      }
      if ((check.data as { es_insumo?: boolean }).es_insumo !== true) {
        return NextResponse.json(errorResponse("El producto vinculado no es un insumo."), { status: 400 });
      }
    }

    const insertPayload: Record<string, unknown> = { empresa_id: ctx.auth.empresa_id, nombre, precio, orden, activo };
    if (insumoProductoId !== undefined) insertPayload.insumo_producto_id = insumoProductoId;
    if (insumoCantidad !== undefined) insertPayload.insumo_cantidad = insumoCantidad;
    if (insumoUnidad !== undefined) insertPayload.insumo_unidad = insumoUnidad;

    const ins = await ctx.supabase
      .from("adicionales")
      .insert(insertPayload)
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
