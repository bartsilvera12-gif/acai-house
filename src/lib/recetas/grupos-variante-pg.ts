/**
 * Fase 2.2 Parte 4 — CRUD de grupos de variantes obligatorias y sus opciones.
 *
 * Reglas comerciales:
 *   - Un grupo pertenece a UNA receta (misma empresa).
 *   - Cada opción apunta a un INSUMO (es_insumo=true, mismo empresa_id) con cantidad+unidad.
 *   - No se precargan defaults automáticos: el cajero elige explícitamente al vender.
 *   - La selección NO cambia el precio del producto.
 *
 * Los triggers del schema validan empresa + es_insumo + activo. Esta capa hace sanity
 * checks livianos antes del INSERT para que los errores HTTP sean 4xx en lugar de 500.
 */

import type { AppSupabaseClient } from "@/lib/supabase/schema";

export type GrupoVarianteRow = {
  id: string;
  empresa_id: string;
  receta_id: string;
  codigo: string;
  etiqueta: string;
  obligatorio: boolean;
  orden: number;
  created_at: string;
  updated_at: string;
};

export type GrupoOpcionRow = {
  id: string;
  empresa_id: string;
  grupo_id: string;
  insumo_producto_id: string;
  cantidad: number;
  unidad_medida: string;
  merma_pct: number;
  etiqueta: string;
  orden: number;
};

export type GrupoConOpciones = GrupoVarianteRow & {
  opciones: (GrupoOpcionRow & { insumo_nombre: string | null; insumo_sku: string | null })[];
};

export async function listGruposDeReceta(
  sb: AppSupabaseClient,
  empresaId: string,
  recetaId: string,
): Promise<GrupoConOpciones[]> {
  const { data: grupos, error: e1 } = await sb
    .from("receta_grupos_variante")
    .select("id, empresa_id, receta_id, codigo, etiqueta, obligatorio, orden, created_at, updated_at")
    .eq("empresa_id", empresaId)
    .eq("receta_id", recetaId)
    .order("orden")
    .order("codigo");
  if (e1) throw new Error(e1.message);
  const gs = (grupos ?? []) as GrupoVarianteRow[];
  if (gs.length === 0) return [];

  const grupoIds = gs.map((g) => g.id);
  const { data: opciones, error: e2 } = await sb
    .from("receta_grupo_opciones")
    .select("id, empresa_id, grupo_id, insumo_producto_id, cantidad, unidad_medida, merma_pct, etiqueta, orden, productos(nombre, sku)")
    .eq("empresa_id", empresaId)
    .in("grupo_id", grupoIds)
    .order("orden");
  if (e2) throw new Error(e2.message);

  const byGrupo = new Map<string, (GrupoOpcionRow & { insumo_nombre: string | null; insumo_sku: string | null })[]>();
  for (const row of (opciones ?? []) as unknown as Array<GrupoOpcionRow & { productos: { nombre: string; sku: string } | null }>) {
    const list = byGrupo.get(row.grupo_id) ?? [];
    list.push({
      id: row.id,
      empresa_id: row.empresa_id,
      grupo_id: row.grupo_id,
      insumo_producto_id: row.insumo_producto_id,
      cantidad: Number(row.cantidad),
      unidad_medida: row.unidad_medida,
      merma_pct: Number(row.merma_pct),
      etiqueta: row.etiqueta,
      orden: row.orden,
      insumo_nombre: row.productos?.nombre ?? null,
      insumo_sku: row.productos?.sku ?? null,
    });
    byGrupo.set(row.grupo_id, list);
  }

  return gs.map((g) => ({ ...g, opciones: byGrupo.get(g.id) ?? [] }));
}

export async function crearGrupo(
  sb: AppSupabaseClient,
  empresaId: string,
  recetaId: string,
  input: { codigo: string; etiqueta: string; obligatorio?: boolean; orden?: number },
): Promise<GrupoVarianteRow> {
  const codigo = input.codigo?.trim().toLowerCase();
  if (!codigo || !/^[a-z][a-z0-9_]{0,31}$/.test(codigo)) {
    throw new Error("Código inválido: usá minúsculas, dígitos y _ (máx 32).");
  }
  const etiqueta = (input.etiqueta ?? "").trim();
  if (etiqueta.length < 1 || etiqueta.length > 60) {
    throw new Error("Etiqueta debe tener 1–60 caracteres.");
  }
  const { data, error } = await sb
    .from("receta_grupos_variante")
    .insert({
      empresa_id: empresaId,
      receta_id: recetaId,
      codigo,
      etiqueta,
      obligatorio: input.obligatorio !== false,
      orden: Number.isFinite(input.orden) ? Number(input.orden) : 0,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as GrupoVarianteRow;
}

export async function updateGrupo(
  sb: AppSupabaseClient,
  empresaId: string,
  grupoId: string,
  patch: Partial<{ etiqueta: string; obligatorio: boolean; orden: number }>,
): Promise<GrupoVarianteRow> {
  const next: Record<string, unknown> = {};
  if (typeof patch.etiqueta === "string") {
    const e = patch.etiqueta.trim();
    if (e.length < 1 || e.length > 60) throw new Error("Etiqueta debe tener 1–60 caracteres.");
    next.etiqueta = e;
  }
  if (typeof patch.obligatorio === "boolean") next.obligatorio = patch.obligatorio;
  if (typeof patch.orden === "number" && Number.isFinite(patch.orden)) next.orden = patch.orden;
  const { data, error } = await sb
    .from("receta_grupos_variante")
    .update(next)
    .eq("empresa_id", empresaId)
    .eq("id", grupoId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as GrupoVarianteRow;
}

export async function deleteGrupo(sb: AppSupabaseClient, empresaId: string, grupoId: string): Promise<void> {
  const { error } = await sb
    .from("receta_grupos_variante")
    .delete()
    .eq("empresa_id", empresaId)
    .eq("id", grupoId);
  if (error) throw new Error(error.message);
}

export async function crearOpcion(
  sb: AppSupabaseClient,
  empresaId: string,
  grupoId: string,
  input: {
    insumo_producto_id: string;
    cantidad: number;
    unidad_medida: string;
    etiqueta: string;
    merma_pct?: number;
    orden?: number;
  },
): Promise<GrupoOpcionRow> {
  if (!input.insumo_producto_id) throw new Error("insumo_producto_id es obligatorio.");
  if (!(Number(input.cantidad) > 0)) throw new Error("cantidad debe ser > 0.");
  if (!input.unidad_medida) throw new Error("unidad_medida es obligatoria.");
  const etiqueta = (input.etiqueta ?? "").trim();
  if (etiqueta.length < 1 || etiqueta.length > 60) throw new Error("Etiqueta debe tener 1–60 caracteres.");
  const mermaPct = input.merma_pct == null ? 0 : Number(input.merma_pct);
  if (!(mermaPct >= 0 && mermaPct < 1)) throw new Error("merma_pct debe estar en [0, 1).");
  const { data, error } = await sb
    .from("receta_grupo_opciones")
    .insert({
      empresa_id: empresaId,
      grupo_id: grupoId,
      insumo_producto_id: input.insumo_producto_id,
      cantidad: Number(input.cantidad),
      unidad_medida: input.unidad_medida,
      merma_pct: mermaPct,
      etiqueta,
      orden: Number.isFinite(input.orden) ? Number(input.orden) : 0,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as GrupoOpcionRow;
}

export async function updateOpcion(
  sb: AppSupabaseClient,
  empresaId: string,
  opcionId: string,
  patch: Partial<{ cantidad: number; unidad_medida: string; merma_pct: number; etiqueta: string; orden: number }>,
): Promise<GrupoOpcionRow> {
  const next: Record<string, unknown> = {};
  if (typeof patch.cantidad === "number") {
    if (!(patch.cantidad > 0)) throw new Error("cantidad debe ser > 0.");
    next.cantidad = patch.cantidad;
  }
  if (typeof patch.unidad_medida === "string") next.unidad_medida = patch.unidad_medida;
  if (typeof patch.merma_pct === "number") {
    if (!(patch.merma_pct >= 0 && patch.merma_pct < 1)) throw new Error("merma_pct debe estar en [0, 1).");
    next.merma_pct = patch.merma_pct;
  }
  if (typeof patch.etiqueta === "string") {
    const e = patch.etiqueta.trim();
    if (e.length < 1 || e.length > 60) throw new Error("Etiqueta debe tener 1–60 caracteres.");
    next.etiqueta = e;
  }
  if (typeof patch.orden === "number") next.orden = patch.orden;
  const { data, error } = await sb
    .from("receta_grupo_opciones")
    .update(next)
    .eq("empresa_id", empresaId)
    .eq("id", opcionId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as GrupoOpcionRow;
}

export async function deleteOpcion(sb: AppSupabaseClient, empresaId: string, opcionId: string): Promise<void> {
  const { error } = await sb
    .from("receta_grupo_opciones")
    .delete()
    .eq("empresa_id", empresaId)
    .eq("id", opcionId);
  if (error) throw new Error(error.message);
}
