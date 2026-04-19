import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
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

/**
 * GET /api/proveedores — lista con categorías resueltas.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;

    const [provRes, relRes, catRes] = await Promise.all([
      supabase.from("proveedores").select("*").eq("empresa_id", empresaId).order("nombre"),
      supabase.from("proveedor_categoria_rel").select("id, proveedor_id, categoria_id").eq("empresa_id", empresaId),
      supabase.from("proveedor_categorias").select("id, nombre, activo").eq("empresa_id", empresaId),
    ]);

    if (provRes.error) {
      return NextResponse.json(errorResponse(provRes.error.message), { status: 500 });
    }
    if (relRes.error) {
      return NextResponse.json(errorResponse(relRes.error.message), { status: 500 });
    }
    if (catRes.error) {
      return NextResponse.json(errorResponse(catRes.error.message), { status: 500 });
    }

    const catById = new Map<string, Pick<ProveedorCategoria, "id" | "nombre" | "activo">>();
    for (const c of catRes.data ?? []) {
      const row = c as Record<string, unknown>;
      catById.set(row.id as string, {
        id: row.id as string,
        nombre: (row.nombre as string) ?? "",
        activo: row.activo !== false,
      });
    }

    const catsByProveedor = new Map<string, Pick<ProveedorCategoria, "id" | "nombre" | "activo">[]>();
    for (const rel of relRes.data ?? []) {
      const row = rel as Record<string, unknown>;
      const pid = row.proveedor_id as string;
      const cid = row.categoria_id as string;
      const cat = catById.get(cid);
      if (!cat) continue;
      const list = catsByProveedor.get(pid) ?? [];
      list.push(cat);
      catsByProveedor.set(pid, list);
    }

    const proveedores: Proveedor[] = (provRes.data ?? []).map((row) => {
      const p = mapProveedorRow(row as Record<string, unknown>);
      p.categorias = catsByProveedor.get(p.id) ?? [];
      return p;
    });

    return NextResponse.json(successResponse({ proveedores }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * POST /api/proveedores — alta con categorías opcionales.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;

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

    const categoriaIds = Array.isArray(body.categoria_ids)
      ? (body.categoria_ids as unknown[]).map((x) => String(x)).filter(Boolean)
      : [];

    const insert = {
      empresa_id: empresaId,
      nombre,
      nombre_comercial: body.nombre_comercial != null ? String(body.nombre_comercial).trim() || null : null,
      razon_social: body.razon_social != null ? String(body.razon_social).trim() || null : null,
      ruc: body.ruc != null ? String(body.ruc).trim() || null : null,
      telefono: body.telefono != null ? String(body.telefono).trim() || null : null,
      email: body.email != null ? String(body.email).trim().toLowerCase() || null : null,
      direccion: body.direccion != null ? String(body.direccion).trim() || null : null,
      contacto: body.contacto != null ? String(body.contacto).trim() || null : null,
      estado: body.estado === "inactivo" ? "inactivo" : "activo",
      condicion_pago:
        body.condicion_pago === "contado" ||
        body.condicion_pago === "credito" ||
        body.condicion_pago === "mixto"
          ? body.condicion_pago
          : null,
      plazo_pago_dias:
        body.plazo_pago_dias != null && String(body.plazo_pago_dias).trim() !== ""
          ? parseInt(String(body.plazo_pago_dias), 10)
          : null,
      moneda_preferida: body.moneda_preferida === "USD" || body.moneda_preferida === "GS" ? body.moneda_preferida : null,
      observaciones: body.observaciones != null ? String(body.observaciones).slice(0, 8000) || null : null,
    };

    if (insert.ruc) {
      const dup = await supabase
        .from("proveedores")
        .select("id, nombre")
        .eq("empresa_id", empresaId)
        .eq("ruc", insert.ruc)
        .maybeSingle();
      if (dup.data) {
        return NextResponse.json(
          errorResponse(`Ya existe un proveedor con el mismo RUC o identificación (“${(dup.data as { nombre?: string }).nombre ?? ""}”).`),
          { status: 409 }
        );
      }
    }

    const { data: created, error: insErr } = await supabase
      .from("proveedores")
      .insert([insert])
      .select("*")
      .single();

    if (insErr || !created) {
      return NextResponse.json(errorResponse(insErr?.message ?? "No se pudo crear el proveedor."), { status: 500 });
    }

    const proveedorId = (created as Record<string, unknown>).id as string;

    if (categoriaIds.length > 0) {
      const valid = await supabase
        .from("proveedor_categorias")
        .select("id")
        .eq("empresa_id", empresaId)
        .in("id", categoriaIds);
      const okIds = new Set((valid.data ?? []).map((r: { id: string }) => r.id));
      const relRows = categoriaIds
        .filter((id) => okIds.has(id))
        .map((categoria_id) => ({
          empresa_id: empresaId,
          proveedor_id: proveedorId,
          categoria_id,
        }));
      if (relRows.length > 0) {
        const { error: relErr } = await supabase.from("proveedor_categoria_rel").insert(relRows);
        if (relErr) {
          await supabase.from("proveedores").delete().eq("id", proveedorId);
          return NextResponse.json(errorResponse(relErr.message), { status: 500 });
        }
      }
    }

    const prov = mapProveedorRow(created as Record<string, unknown>);
    if (categoriaIds.length > 0) {
      const { data: rels } = await supabase
        .from("proveedor_categoria_rel")
        .select("categoria_id")
        .eq("proveedor_id", proveedorId);
      const ids = (rels ?? []).map((r: { categoria_id: string }) => r.categoria_id);
      if (ids.length > 0) {
        const { data: cats } = await supabase
          .from("proveedor_categorias")
          .select("id, nombre, activo")
          .in("id", ids);
        prov.categorias = (cats ?? []).map((c: Record<string, unknown>) => ({
          id: c.id as string,
          nombre: (c.nombre as string) ?? "",
          activo: c.activo !== false,
        }));
      } else {
        prov.categorias = [];
      }
    } else {
      prov.categorias = [];
    }

    return NextResponse.json(successResponse({ proveedor: prov }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
