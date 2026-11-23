import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * Presentaciones (tamaños) de un producto.
 * GET  → lista las presentaciones del producto.
 * PUT  → reemplaza TODO el conjunto de presentaciones del producto (editor "todo-o-nada").
 *
 * No usamos POST aislado para no mantener dos caminos de persistencia; el editor
 * del formulario de producto manda el arreglo completo y el backend sincroniza.
 */

const COLS = "id, empresa_id, producto_id, nombre, precio, orden, activo, created_at, updated_at";

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
      .from("producto_presentaciones")
      .select(COLS)
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("producto_id", id)
      .order("orden")
      .order("nombre");
    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ presentaciones: data ?? [] }));
  } catch (err) {
    console.error("[/api/productos/[id]/presentaciones GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las presentaciones."), { status: 500 });
  }
}

interface PresentacionInput {
  id?: string | null;
  nombre: string;
  precio: number;
  orden?: number;
  activo?: boolean;
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

    const raw = Array.isArray(body.presentaciones) ? (body.presentaciones as unknown[]) : [];
    const normalizadas: PresentacionInput[] = [];
    const nombresVistos = new Set<string>();

    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const it = item as Record<string, unknown>;
      const nombre = typeof it.nombre === "string" ? it.nombre.trim() : "";
      if (!nombre) continue;
      const precio = Number(it.precio);
      if (!Number.isFinite(precio) || precio < 0) {
        return NextResponse.json(
          errorResponse(`Precio inválido para la presentación "${nombre}".`),
          { status: 400 },
        );
      }
      const key = nombre.toLowerCase();
      if (nombresVistos.has(key)) {
        return NextResponse.json(
          errorResponse(`La presentación "${nombre}" aparece dos veces. Usá un nombre único por tamaño.`),
          { status: 400 },
        );
      }
      nombresVistos.add(key);
      normalizadas.push({
        id: typeof it.id === "string" && it.id.length > 0 ? it.id : null,
        nombre,
        precio,
        orden: Number.isFinite(Number(it.orden)) ? Number(it.orden) : normalizadas.length * 10,
        activo: it.activo === false ? false : true,
      });
    }

    const existentesRes = await sb
      .from("producto_presentaciones")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("producto_id", productoId);
    if (existentesRes.error) throw new Error(existentesRes.error.message);
    const existingIds = new Set(((existentesRes.data ?? []) as { id: string }[]).map((r) => r.id));
    const keepIds = new Set(normalizadas.map((p) => p.id).filter((v): v is string => !!v));
    const toDelete = [...existingIds].filter((i) => !keepIds.has(i));

    // Borrar las que ya no están.
    // Fase 2.2: ON DELETE RESTRICT en recetas.presentacion_id. Si alguna presentación
    // a borrar tiene una receta vinculada, PG rechazará con ERRCODE 23503. Lo detectamos
    // antes de intentar el DELETE para dar un mensaje claro al usuario (en vez del error crudo).
    if (toDelete.length > 0) {
      const recetasVinc = await sb
        .from("recetas")
        .select("id, presentacion_id, nombre")
        .eq("empresa_id", empresaId)
        .in("presentacion_id", toDelete);
      if (recetasVinc.error) throw new Error(recetasVinc.error.message);
      const vinculadas = (recetasVinc.data ?? []) as Array<{ presentacion_id: string }>;
      if (vinculadas.length > 0) {
        // Nombres de las presentaciones afectadas para el mensaje.
        const nombresAfectados = Array.from(new Set(
          vinculadas.map((r) => {
            const match = normalizadas.find((p) => p.id === r.presentacion_id);
            return match?.nombre ?? r.presentacion_id;
          }),
        ));
        // Pero toDelete son las que SE QUITARON del arreglo, así que no están en normalizadas.
        // Mejor volver a buscar los nombres originales:
        const origen = await sb
          .from("producto_presentaciones")
          .select("id, nombre")
          .in("id", vinculadas.map((v) => v.presentacion_id));
        const nombresReal = Array.isArray(origen.data)
          ? origen.data.map((r: { nombre: string }) => r.nombre).join(", ")
          : nombresAfectados.join(", ");
        return NextResponse.json(
          errorResponse(
            `No se puede eliminar la(s) presentación(es) "${nombresReal}": tiene(n) receta vinculada. Primero archivá o eliminá la receta desde /dashboard/recetas, o desactivá la presentación en lugar de borrarla.`,
          ),
          { status: 409 },
        );
      }
      const del = await sb
        .from("producto_presentaciones")
        .delete()
        .eq("empresa_id", empresaId)
        .eq("producto_id", productoId)
        .in("id", toDelete);
      if (del.error) {
        // Fallback si el check previo no detectó algo (cambio concurrente)
        if (/23503|foreign key/i.test(del.error.message)) {
          return NextResponse.json(
            errorResponse("No se puede eliminar una presentación con recetas vinculadas. Archivá primero la receta."),
            { status: 409 },
          );
        }
        throw new Error(del.error.message);
      }
    }

    // Upsert manual: update si trae id, insert si no.
    for (const p of normalizadas) {
      if (p.id) {
        const upd = await sb
          .from("producto_presentaciones")
          .update({
            nombre: p.nombre,
            precio: p.precio,
            orden: p.orden ?? 0,
            activo: p.activo ?? true,
          })
          .eq("empresa_id", empresaId)
          .eq("producto_id", productoId)
          .eq("id", p.id);
        if (upd.error) throw new Error(upd.error.message);
      } else {
        const ins = await sb.from("producto_presentaciones").insert({
          empresa_id: empresaId,
          producto_id: productoId,
          nombre: p.nombre,
          precio: p.precio,
          orden: p.orden ?? 0,
          activo: p.activo ?? true,
        });
        if (ins.error) {
          const msg = ins.error.message ?? "";
          if (/duplicate key|unique|23505/i.test(msg)) {
            return NextResponse.json(
              errorResponse(`Ya existe la presentación "${p.nombre}" para este producto.`),
              { status: 409 },
            );
          }
          throw new Error(msg);
        }
      }
    }

    const final = await sb
      .from("producto_presentaciones")
      .select(COLS)
      .eq("empresa_id", empresaId)
      .eq("producto_id", productoId)
      .order("orden")
      .order("nombre");
    if (final.error) throw new Error(final.error.message);

    return NextResponse.json(successResponse({ presentaciones: final.data ?? [] }));
  } catch (err) {
    console.error("[/api/productos/[id]/presentaciones PUT]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron guardar las presentaciones."), { status: 500 });
  }
}
