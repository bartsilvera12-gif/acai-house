import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * Adicionales permitidos para un producto.
 *
 * Semántica
 * ---------
 *   • GET: devuelve `adicional_id[]`. Lista vacía = "todos los adicionales activos
 *     aplican" (default permisivo).
 *   • PUT: reemplaza el conjunto para ese producto. Enviar `{ adicional_ids: [] }`
 *     vuelve al modo "todos aplican".
 */

async function productoPerteneceEmpresa(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  empresaId: string,
  productoId: string,
): Promise<boolean> {
  const { data, error } = await sb
    .from("productos")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("id", productoId)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export async function GET(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { data, error } = await ctx.supabase
      .from("producto_adicionales_permitidos")
      .select("adicional_id")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("producto_id", id);
    if (error) throw new Error(error.message);
    const ids = ((data ?? []) as Array<{ adicional_id: string }>).map((r) => r.adicional_id);
    return NextResponse.json(successResponse({ adicional_ids: ids }));
  } catch (err) {
    console.error("[/api/productos/[id]/adicionales-permitidos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los adicionales permitidos."), { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> },
) {
  try {
    const { id: productoId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const sb = ctx.supabase;

    if (!(await productoPerteneceEmpresa(sb, empresaId, productoId))) {
      return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const raw = body.adicional_ids;
    if (!Array.isArray(raw)) {
      return NextResponse.json(errorResponse("adicional_ids debe ser un array."), { status: 400 });
    }
    const wanted = new Set<string>();
    for (const x of raw) {
      if (typeof x === "string" && x.length > 0) wanted.add(x);
    }

    // Validar que los ids pertenezcan a la empresa (defensa en profundidad).
    if (wanted.size > 0) {
      const chk = await sb
        .from("adicionales")
        .select("id")
        .eq("empresa_id", empresaId)
        .in("id", [...wanted]);
      if (chk.error) throw new Error(chk.error.message);
      const validos = new Set(((chk.data ?? []) as Array<{ id: string }>).map((r) => r.id));
      for (const id of wanted) {
        if (!validos.has(id)) {
          return NextResponse.json(
            errorResponse(`Adicional ${id} no pertenece a la empresa.`),
            { status: 400 },
          );
        }
      }
    }

    // Diff contra lo actual.
    const curRes = await sb
      .from("producto_adicionales_permitidos")
      .select("adicional_id")
      .eq("empresa_id", empresaId)
      .eq("producto_id", productoId);
    if (curRes.error) throw new Error(curRes.error.message);
    const current = new Set(((curRes.data ?? []) as Array<{ adicional_id: string }>).map((r) => r.adicional_id));

    const toDelete = [...current].filter((aid) => !wanted.has(aid));
    const toInsert = [...wanted].filter((aid) => !current.has(aid));

    if (toDelete.length > 0) {
      const del = await sb
        .from("producto_adicionales_permitidos")
        .delete()
        .eq("empresa_id", empresaId)
        .eq("producto_id", productoId)
        .in("adicional_id", toDelete);
      if (del.error) throw new Error(del.error.message);
    }

    if (toInsert.length > 0) {
      const rows = toInsert.map((aid) => ({
        empresa_id: empresaId,
        producto_id: productoId,
        adicional_id: aid,
      }));
      const ins = await sb.from("producto_adicionales_permitidos").insert(rows);
      if (ins.error) throw new Error(ins.error.message);
    }

    return NextResponse.json(
      successResponse({ adicional_ids: [...wanted], restringido: wanted.size > 0 }),
    );
  } catch (err) {
    console.error("[/api/productos/[id]/adicionales-permitidos PUT]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron guardar los adicionales permitidos."), { status: 500 });
  }
}
