import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import type { Proveedor, ProveedorCategoria } from "@/lib/proveedores/types";

function mapProveedorRow(r: Record<string, unknown>): Proveedor {
  return {
    id: r.id as string,
    empresa_id: r.empresa_id as string | undefined,
    nombre: (r.nombre as string) ?? "",
    nombre_comercial: (r.nombre_comercial as string) ?? null,
    razon_social: (r.razon_social as string) ?? null,
    ruc: (r.ruc as string) ?? null,
    telefono: (r.telefono as string) ?? null,
    email: (r.email as string) ?? null,
    direccion: (r.direccion as string) ?? null,
    contacto: (r.contacto as string) ?? null,
    estado: r.estado === "inactivo" ? "inactivo" : "activo",
    condicion_pago:
      r.condicion_pago === "contado" || r.condicion_pago === "credito" || r.condicion_pago === "mixto"
        ? r.condicion_pago
        : null,
    plazo_pago_dias: r.plazo_pago_dias != null ? Number(r.plazo_pago_dias) : null,
    moneda_preferida: r.moneda_preferida === "USD" ? "USD" : r.moneda_preferida === "GS" ? "GS" : null,
    observaciones: (r.observaciones as string) ?? null,
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
  };
}

async function attachCategorias(
  supabase: AppSupabaseClient,
  empresaId: string,
  proveedorId: string
): Promise<Pick<ProveedorCategoria, "id" | "nombre" | "activo">[]> {
  const { data: rels } = await supabase
    .from("proveedor_categoria_rel")
    .select("categoria_id")
    .eq("empresa_id", empresaId)
    .eq("proveedor_id", proveedorId);
  const ids = (rels ?? []).map((r: { categoria_id: string }) => r.categoria_id);
  if (ids.length === 0) return [];
  const { data: cats } = await supabase
    .from("proveedor_categorias")
    .select("id, nombre, activo")
    .eq("empresa_id", empresaId)
    .in("id", ids);
  return (cats ?? []).map((c: Record<string, unknown>) => ({
    id: c.id as string,
    nombre: (c.nombre as string) ?? "",
    activo: c.activo !== false,
  }));
}

/**
 * GET /api/proveedores/[id]
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const tenant = await getTenantSupabaseFromAuth(request);
    if (!tenant) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { supabase, auth } = tenant;
    const empresaId = auth.empresa_id;
    const { id } = await ctx.params;

    const { data: row, error } = await supabase
      .from("proveedores")
      .select("*")
      .eq("empresa_id", empresaId)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 500 });
    }
    if (!row) {
      return NextResponse.json(errorResponse("Proveedor no encontrado."), { status: 404 });
    }

    const prov = mapProveedorRow(row as Record<string, unknown>);
    prov.categorias = await attachCategorias(supabase, empresaId, id);
    return NextResponse.json(successResponse({ proveedor: prov }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * PATCH /api/proveedores/[id] — actualización parcial; `categoria_ids` reemplaza asignaciones.
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

    const { data: existing, error: exErr } = await supabase
      .from("proveedores")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("id", id)
      .maybeSingle();

    if (exErr) {
      return NextResponse.json(errorResponse(exErr.message), { status: 500 });
    }
    if (!existing) {
      return NextResponse.json(errorResponse("Proveedor no encontrado."), { status: 404 });
    }

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
    if (body.nombre_comercial !== undefined) {
      patch.nombre_comercial = body.nombre_comercial != null ? String(body.nombre_comercial).trim() || null : null;
    }
    if (body.razon_social !== undefined) {
      patch.razon_social = body.razon_social != null ? String(body.razon_social).trim() || null : null;
    }
    if (body.ruc !== undefined) {
      patch.ruc = body.ruc != null ? String(body.ruc).trim() || null : null;
    }
    if (body.telefono !== undefined) {
      patch.telefono = body.telefono != null ? String(body.telefono).trim() || null : null;
    }
    if (body.email !== undefined) {
      patch.email = body.email != null ? String(body.email).trim().toLowerCase() || null : null;
    }
    if (body.direccion !== undefined) {
      patch.direccion = body.direccion != null ? String(body.direccion).trim() || null : null;
    }
    if (body.contacto !== undefined) {
      patch.contacto = body.contacto != null ? String(body.contacto).trim() || null : null;
    }
    if (body.estado !== undefined) {
      patch.estado = body.estado === "inactivo" ? "inactivo" : "activo";
    }
    if (body.condicion_pago !== undefined) {
      patch.condicion_pago =
        body.condicion_pago === "contado" ||
        body.condicion_pago === "credito" ||
        body.condicion_pago === "mixto"
          ? body.condicion_pago
          : null;
    }
    if (body.plazo_pago_dias !== undefined) {
      patch.plazo_pago_dias =
        body.plazo_pago_dias != null && String(body.plazo_pago_dias).trim() !== ""
          ? parseInt(String(body.plazo_pago_dias), 10)
          : null;
    }
    if (body.moneda_preferida !== undefined) {
      patch.moneda_preferida =
        body.moneda_preferida === "USD" || body.moneda_preferida === "GS" ? body.moneda_preferida : null;
    }
    if (body.observaciones !== undefined) {
      patch.observaciones = body.observaciones != null ? String(body.observaciones).slice(0, 8000) || null : null;
    }

    if (patch.ruc && typeof patch.ruc === "string") {
      const { data: dup } = await supabase
        .from("proveedores")
        .select("id, nombre")
        .eq("empresa_id", empresaId)
        .eq("ruc", patch.ruc)
        .neq("id", id)
        .maybeSingle();
      if (dup) {
        return NextResponse.json(
          errorResponse(`Ya existe otro proveedor con el mismo RUC (“${(dup as { nombre?: string }).nombre ?? ""}”).`),
          { status: 409 }
        );
      }
    }

    if (Object.keys(patch).length > 0) {
      const { error: updErr } = await supabase.from("proveedores").update(patch).eq("id", id).eq("empresa_id", empresaId);
      if (updErr) {
        return NextResponse.json(errorResponse(updErr.message), { status: 500 });
      }
    }

    if (Array.isArray(body.categoria_ids)) {
      const categoriaIds = (body.categoria_ids as unknown[]).map((x) => String(x)).filter(Boolean);
      await supabase.from("proveedor_categoria_rel").delete().eq("proveedor_id", id).eq("empresa_id", empresaId);

      if (categoriaIds.length > 0) {
        const valid = await supabase
          .from("proveedor_categorias")
          .select("id")
          .eq("empresa_id", empresaId)
          .in("id", categoriaIds);
        const okIds = new Set((valid.data ?? []).map((r: { id: string }) => r.id));
        const relRows = categoriaIds
          .filter((cid) => okIds.has(cid))
          .map((categoria_id) => ({
            empresa_id: empresaId,
            proveedor_id: id,
            categoria_id,
          }));
        if (relRows.length > 0) {
          const { error: relErr } = await supabase.from("proveedor_categoria_rel").insert(relRows);
          if (relErr) {
            return NextResponse.json(errorResponse(relErr.message), { status: 500 });
          }
        }
      }
    }

    const { data: row } = await supabase.from("proveedores").select("*").eq("id", id).eq("empresa_id", empresaId).single();

    const prov = mapProveedorRow(row as Record<string, unknown>);
    prov.categorias = await attachCategorias(supabase, empresaId, id);
    return NextResponse.json(successResponse({ proveedor: prov }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
