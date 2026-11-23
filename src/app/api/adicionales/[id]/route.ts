import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

const COLS = "id, empresa_id, nombre, precio, orden, activo, insumo_producto_id, insumo_cantidad, insumo_unidad, created_at, updated_at";

export async function PATCH(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    if (typeof body.nombre === "string") {
      const n = body.nombre.trim();
      if (!n) return NextResponse.json(errorResponse("El nombre no puede ser vacío."), { status: 400 });
      patch.nombre = n;
    }
    if (body.precio !== undefined) {
      const p = Number(body.precio);
      if (!Number.isFinite(p) || p < 0) {
        return NextResponse.json(errorResponse("Precio inválido."), { status: 400 });
      }
      patch.precio = p;
    }
    if (body.orden !== undefined) {
      const o = Number(body.orden);
      if (!Number.isFinite(o)) return NextResponse.json(errorResponse("Orden inválido."), { status: 400 });
      patch.orden = o;
    }
    if (typeof body.activo === "boolean") patch.activo = body.activo;

    // Fase 2.2: vínculo insumo físico (alternativa A).
    if (body.insumo_producto_id !== undefined) {
      const v = body.insumo_producto_id;
      const id = v === null || v === "" ? null : String(v);
      if (id) {
        const check = await ctx.supabase
          .from("productos")
          .select("id, es_insumo")
          .eq("empresa_id", ctx.auth.empresa_id)
          .eq("id", id)
          .maybeSingle();
        if (check.error) throw new Error(check.error.message);
        if (!check.data) return NextResponse.json(errorResponse("El insumo indicado no existe."), { status: 400 });
        if ((check.data as { es_insumo?: boolean }).es_insumo !== true) {
          return NextResponse.json(errorResponse("El producto vinculado no es un insumo."), { status: 400 });
        }
      }
      patch.insumo_producto_id = id;
    }
    if (body.insumo_cantidad !== undefined) {
      const v = body.insumo_cantidad;
      if (v === null || v === "") patch.insumo_cantidad = null;
      else {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) {
          return NextResponse.json(errorResponse("La cantidad de insumo debe ser > 0 o nula."), { status: 400 });
        }
        patch.insumo_cantidad = n;
      }
    }
    if (body.insumo_unidad !== undefined) {
      const v = body.insumo_unidad;
      patch.insumo_unidad = v === null || String(v).trim() === "" ? null : String(v).trim();
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(errorResponse("Nada para actualizar."), { status: 400 });
    }

    const upd = await ctx.supabase
      .from("adicionales")
      .update(patch)
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .select(COLS)
      .maybeSingle();
    if (upd.error) {
      const msg = upd.error.message ?? "";
      if (/duplicate key|unique|23505/i.test(msg)) {
        return NextResponse.json(errorResponse("Ya existe un adicional con ese nombre."), { status: 409 });
      }
      console.error("[/api/adicionales/[id] PATCH]", msg);
      return NextResponse.json(errorResponse("No se pudo actualizar el adicional."), { status: 500 });
    }
    if (!upd.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    return NextResponse.json(successResponse({ adicional: upd.data }));
  } catch (err) {
    console.error("[/api/adicionales/[id] PATCH] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar el adicional."), { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    // Soft delete: dejamos el histórico (algún ticket pasado puede referenciarlo).
    const upd = await ctx.supabase
      .from("adicionales")
      .update({ activo: false })
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (upd.error) {
      console.error("[/api/adicionales/[id] DELETE]", upd.error.message);
      return NextResponse.json(errorResponse("No se pudo desactivar el adicional."), { status: 500 });
    }
    if (!upd.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    return NextResponse.json(successResponse({ id }));
  } catch (err) {
    console.error("[/api/adicionales/[id] DELETE] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo desactivar el adicional."), { status: 500 });
  }
}
