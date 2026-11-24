import type { AppSupabaseClient } from "@/lib/supabase/schema";

export type RecetaRow = {
  id: string;
  empresa_id: string;
  producto_id: string;
  /** Fase 2.2: presentación específica (tamaño) o NULL = receta base del producto. */
  presentacion_id: string | null;
  nombre: string | null;
  rendimiento_cantidad: number;
  rendimiento_unidad: string | null;
  notas: string | null;
  activa: boolean;
  created_at: string;
  updated_at: string;
};

export type RecetaItemRow = {
  id: string;
  receta_id: string;
  empresa_id: string;
  insumo_producto_id: string;
  cantidad: number;
  unidad_medida: string | null;
  merma_pct: number;
  orden: number;
};

export type RecetaCosteo = {
  receta_id: string;
  producto_id: string;
  rendimiento_cantidad: number;
  costo_total: number;
  costo_unitario: number | null;
  precio_venta: number;
  margen_abs: number;
  margen_pct: number | null;
  unidades_posibles: number | null;
  items: Array<{
    item_id: string;
    insumo_producto_id: string;
    insumo_nombre: string;
    cantidad: number;
    unidad_medida: string | null;
    merma_pct: number;
    costo_promedio: number;
    stock_actual: number;
    subcosto: number;
    unidades_aporte: number | null;
  }>;
  error?: string;
};

export async function listRecetas(sb: AppSupabaseClient, empresaId: string) {
  // Fase 2.2: evitamos el embedded join con `producto_presentaciones` porque, tras
  // el ALTER TABLE que agregó `recetas.presentacion_id` (FK), el schema cache de
  // PostgREST puede no haber refrescado todavía y el embed falla con 500. Hacemos
  // tres queries independientes y las relacionamos en JS; el filtro por empresa
  // se preserva en cada una y mantenemos compatibilidad con recetas históricas
  // (presentacion_id = NULL → presentacion_nombre = null).
  const { data: recetas, error } = await sb
    .from("recetas")
    .select("id, producto_id, presentacion_id, nombre, rendimiento_cantidad, rendimiento_unidad, activa, updated_at")
    .eq("empresa_id", empresaId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (recetas ?? []) as Array<{
    id: string;
    producto_id: string;
    presentacion_id: string | null;
    nombre: string | null;
    rendimiento_cantidad: number;
    rendimiento_unidad: string | null;
    activa: boolean;
    updated_at: string;
  }>;
  if (rows.length === 0) return [];

  const productoIds = Array.from(new Set(rows.map((r) => r.producto_id)));
  const presentacionIds = Array.from(
    new Set(rows.map((r) => r.presentacion_id).filter((v): v is string => !!v)),
  );

  const [prodRes, presRes] = await Promise.all([
    productoIds.length > 0
      ? sb.from("productos").select("id, nombre").eq("empresa_id", empresaId).in("id", productoIds)
      : Promise.resolve({ data: [], error: null }),
    presentacionIds.length > 0
      ? sb
          .from("producto_presentaciones")
          .select("id, nombre")
          .eq("empresa_id", empresaId)
          .in("id", presentacionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (prodRes.error) throw new Error(prodRes.error.message);
  if (presRes.error) throw new Error(presRes.error.message);

  const prodMap = new Map<string, string>();
  for (const p of (prodRes.data ?? []) as Array<{ id: string; nombre: string }>) {
    prodMap.set(p.id, p.nombre);
  }
  const presMap = new Map<string, string>();
  for (const p of (presRes.data ?? []) as Array<{ id: string; nombre: string }>) {
    presMap.set(p.id, p.nombre);
  }

  return rows.map((r) => ({
    ...r,
    producto_nombre: prodMap.get(r.producto_id) ?? null,
    presentacion_nombre: r.presentacion_id ? presMap.get(r.presentacion_id) ?? null : null,
  }));
}

export async function getReceta(sb: AppSupabaseClient, empresaId: string, id: string) {
  const { data, error } = await sb
    .from("recetas")
    .select("*, productos(nombre)")
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    ...(row as unknown as RecetaRow),
    producto_nombre: (row.productos as { nombre?: string } | null)?.nombre ?? null,
  } as RecetaRow & { producto_nombre: string | null };
}

/** Fase 2.2 Parte 4: grupos obligatorios + opciones indexados por receta.
 *  Devuelve estructura lista para consumir desde la UI del POS. */
export type RecetaGrupoOpcionUi = {
  id: string;
  insumo_producto_id: string;
  insumo_nombre: string | null;
  insumo_sku: string | null;
  etiqueta: string;
  cantidad: number;
  unidad_medida: string;
  merma_pct: number;
  orden: number;
};
export type RecetaGrupoUi = {
  id: string;
  codigo: string;
  etiqueta: string;
  obligatorio: boolean;
  orden: number;
  opciones: RecetaGrupoOpcionUi[];
};
export async function listGruposDeRecetas(
  sb: AppSupabaseClient,
  empresaId: string,
  recetaIds: string[],
): Promise<Map<string, RecetaGrupoUi[]>> {
  const out = new Map<string, RecetaGrupoUi[]>();
  if (recetaIds.length === 0) return out;
  const { data: grupos, error: e1 } = await sb
    .from("receta_grupos_variante")
    .select("id, receta_id, codigo, etiqueta, obligatorio, orden")
    .eq("empresa_id", empresaId)
    .in("receta_id", recetaIds)
    .order("orden");
  if (e1) throw new Error(e1.message);
  const gs = (grupos ?? []) as Array<{ id: string; receta_id: string; codigo: string; etiqueta: string; obligatorio: boolean; orden: number }>;
  if (gs.length === 0) return out;
  const grupoIds = gs.map((g) => g.id);
  const { data: opciones, error: e2 } = await sb
    .from("receta_grupo_opciones")
    .select("id, grupo_id, insumo_producto_id, cantidad, unidad_medida, merma_pct, etiqueta, orden, productos(nombre, sku)")
    .eq("empresa_id", empresaId)
    .in("grupo_id", grupoIds)
    .order("orden");
  if (e2) throw new Error(e2.message);
  const opsByGrupo = new Map<string, RecetaGrupoOpcionUi[]>();
  for (const row of (opciones ?? []) as unknown as Array<{
    id: string; grupo_id: string; insumo_producto_id: string;
    cantidad: number | string; unidad_medida: string; merma_pct: number | string;
    etiqueta: string; orden: number;
    productos: { nombre?: string; sku?: string } | null;
  }>) {
    const arr = opsByGrupo.get(row.grupo_id) ?? [];
    arr.push({
      id: row.id,
      insumo_producto_id: row.insumo_producto_id,
      insumo_nombre: row.productos?.nombre ?? null,
      insumo_sku: row.productos?.sku ?? null,
      etiqueta: row.etiqueta,
      cantidad: Number(row.cantidad),
      unidad_medida: row.unidad_medida,
      merma_pct: Number(row.merma_pct ?? 0),
      orden: row.orden,
    });
    opsByGrupo.set(row.grupo_id, arr);
  }
  for (const g of gs) {
    const arr = out.get(g.receta_id) ?? [];
    arr.push({
      id: g.id,
      codigo: g.codigo,
      etiqueta: g.etiqueta,
      obligatorio: g.obligatorio,
      orden: g.orden,
      opciones: opsByGrupo.get(g.id) ?? [],
    });
    out.set(g.receta_id, arr);
  }
  return out;
}

export async function listRecetaItems(sb: AppSupabaseClient, recetaId: string) {
  const { data, error } = await sb
    .from("receta_items")
    .select("id, receta_id, empresa_id, insumo_producto_id, cantidad, unidad_medida, merma_pct, orden")
    .eq("receta_id", recetaId)
    .order("orden", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as RecetaItemRow[];
}

export async function getRecetaCosteo(
  sb: AppSupabaseClient,
  recetaId: string
): Promise<RecetaCosteo | null> {
  const { data, error } = await sb.rpc("fn_receta_costeo" as never, {
    p_receta_id: recetaId,
  } as never);
  if (error) throw new Error(error.message);
  return (data ?? null) as RecetaCosteo | null;
}

export async function insertReceta(
  sb: AppSupabaseClient,
  empresaId: string,
  input: {
    producto_id: string;
    /** Fase 2.2: presentación específica. NULL / undefined = receta base del producto. */
    presentacion_id?: string | null;
    nombre?: string | null;
    rendimiento_cantidad?: number;
    rendimiento_unidad?: string | null;
    notas?: string | null;
    activa?: boolean;
  }
) {
  const { data, error } = await sb
    .from("recetas")
    .insert({
      empresa_id: empresaId,
      producto_id: input.producto_id,
      presentacion_id: input.presentacion_id ?? null,
      nombre: input.nombre ?? null,
      rendimiento_cantidad: input.rendimiento_cantidad ?? 1,
      rendimiento_unidad: input.rendimiento_unidad ?? null,
      notas: input.notas ?? null,
      activa: input.activa ?? true,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as RecetaRow;
}

export async function updateReceta(
  sb: AppSupabaseClient,
  empresaId: string,
  id: string,
  patch: Partial<{
    presentacion_id: string | null;
    nombre: string | null;
    rendimiento_cantidad: number;
    rendimiento_unidad: string | null;
    notas: string | null;
    activa: boolean;
  }>
) {
  const { data, error } = await sb
    .from("recetas")
    .update(patch)
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as RecetaRow;
}

export async function deleteReceta(sb: AppSupabaseClient, empresaId: string, id: string) {
  const { error } = await sb.from("recetas").delete().eq("empresa_id", empresaId).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function insertRecetaItem(
  sb: AppSupabaseClient,
  empresaId: string,
  recetaId: string,
  input: {
    insumo_producto_id: string;
    cantidad: number;
    unidad_medida?: string | null;
    merma_pct?: number;
    orden?: number;
  }
) {
  const { data, error } = await sb
    .from("receta_items")
    .insert({
      empresa_id: empresaId,
      receta_id: recetaId,
      insumo_producto_id: input.insumo_producto_id,
      cantidad: input.cantidad,
      unidad_medida: input.unidad_medida ?? null,
      merma_pct: input.merma_pct ?? 0,
      orden: input.orden ?? 0,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as RecetaItemRow;
}

export async function updateRecetaItem(
  sb: AppSupabaseClient,
  itemId: string,
  patch: Partial<{
    cantidad: number;
    unidad_medida: string | null;
    merma_pct: number;
    orden: number;
  }>
) {
  const { data, error } = await sb
    .from("receta_items")
    .update(patch)
    .eq("id", itemId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as RecetaItemRow;
}

export async function deleteRecetaItem(sb: AppSupabaseClient, itemId: string) {
  const { error } = await sb.from("receta_items").delete().eq("id", itemId);
  if (error) throw new Error(error.message);
}

/** Productos vendibles SIN receta (para listado en "Crear receta").
 *  Fase 2.2: "sin receta" = sin receta activa *base* (presentacion_id IS NULL). Un producto
 *  puede tener recetas activas por presentación y aún así necesitar una base, o viceversa.
 *  La UI de Fase 2.2 usa `vendibles-menu` para listar TODOS los productos de menú y crear
 *  recetas por presentación. Este filtro queda compatible para el flujo legacy.
 */
export async function listProductosVendiblesSinReceta(sb: AppSupabaseClient, empresaId: string) {
  const { data: usados, error: errUsados } = await sb
    .from("recetas")
    .select("producto_id, presentacion_id, activa")
    .eq("empresa_id", empresaId);
  if (errUsados) throw new Error(errUsados.message);
  const usadosSet = new Set(
    ((usados ?? []) as Array<{ producto_id: string; presentacion_id: string | null; activa: boolean }>)
      .filter((r) => r.activa && r.presentacion_id === null)
      .map((r) => r.producto_id),
  );
  const { data, error } = await sb
    .from("productos")
    .select("id, nombre, sku, precio_venta, unidad_medida")
    .eq("empresa_id", empresaId)
    .eq("activo", true)
    .eq("es_vendible", true)
    .eq("controla_stock", false)
    .order("nombre");
  if (error) throw new Error(error.message);
  return (data ?? []).filter((p: { id: string }) => !usadosSet.has(p.id));
}

/** Fase 2.2: productos de menú (vendibles + preparado_al_vender) para crear recetas por
 *  presentación. Incluye los que ya tienen receta base (para poder sumar las por-presentación). */
export async function listProductosMenu(sb: AppSupabaseClient, empresaId: string) {
  const { data, error } = await sb
    .from("productos")
    .select("id, nombre, sku, precio_venta, unidad_medida, categoria_principal_id")
    .eq("empresa_id", empresaId)
    .eq("activo", true)
    .eq("es_vendible", true)
    .eq("controla_stock", false)
    .order("nombre");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Fase 2.2: presentaciones ACTIVAS de un producto, para poblar el selector de la UI de recetas. */
export async function listPresentacionesDeProducto(
  sb: AppSupabaseClient,
  empresaId: string,
  productoId: string,
) {
  const { data, error } = await sb
    .from("producto_presentaciones")
    .select("id, nombre, precio, orden, activo")
    .eq("empresa_id", empresaId)
    .eq("producto_id", productoId)
    .eq("activo", true)
    .order("orden")
    .order("nombre");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Fase 2.2: matriz producto × presentación → tiene receta activa? Para el badge "pendientes". */
export async function getRecetaCoberturaMatriz(sb: AppSupabaseClient, empresaId: string) {
  const [productos, presentaciones, recetas] = await Promise.all([
    sb.from("productos").select("id, nombre, sku, categoria_principal_id")
      .eq("empresa_id", empresaId).eq("es_vendible", true).eq("controla_stock", false).eq("activo", true),
    sb.from("producto_presentaciones").select("id, producto_id, nombre, orden, activo")
      .eq("empresa_id", empresaId).eq("activo", true),
    sb.from("recetas").select("producto_id, presentacion_id, activa")
      .eq("empresa_id", empresaId).eq("activa", true),
  ]);
  if (productos.error) throw new Error(productos.error.message);
  if (presentaciones.error) throw new Error(presentaciones.error.message);
  if (recetas.error) throw new Error(recetas.error.message);

  const recetasSet = new Set(
    ((recetas.data ?? []) as Array<{ producto_id: string; presentacion_id: string | null }>)
      .map((r) => `${r.producto_id}:${r.presentacion_id ?? "NULL"}`),
  );
  const presByProd = new Map<string, Array<{ id: string; nombre: string; orden: number }>>();
  for (const pp of (presentaciones.data ?? []) as Array<{ id: string; producto_id: string; nombre: string; orden: number }>) {
    const arr = presByProd.get(pp.producto_id) ?? [];
    arr.push({ id: pp.id, nombre: pp.nombre, orden: pp.orden });
    presByProd.set(pp.producto_id, arr);
  }
  return ((productos.data ?? []) as Array<{ id: string; nombre: string; sku: string; categoria_principal_id: string | null }>)
    .map((p) => {
      const pres = (presByProd.get(p.id) ?? []).sort((a, b) => a.orden - b.orden);
      const rows = pres.length > 0
        ? pres.map((pp) => ({
            presentacion_id: pp.id,
            presentacion_nombre: pp.nombre,
            tiene_receta: recetasSet.has(`${p.id}:${pp.id}`),
          }))
        : [{ presentacion_id: null, presentacion_nombre: null, tiene_receta: recetasSet.has(`${p.id}:NULL`) }];
      return { producto_id: p.id, producto_nombre: p.nombre, sku: p.sku, presentaciones: rows };
    });
}

export async function listProductos(
  sb: AppSupabaseClient,
  empresaId: string,
  filtro: "vendibles" | "insumos" | "todos"
) {
  let q = sb
    .from("productos")
    .select("id, nombre, sku, precio_venta, costo_promedio, stock_actual, unidad_medida, es_insumo, es_vendible")
    .eq("empresa_id", empresaId)
    .eq("activo", true)
    .order("nombre");
  if (filtro === "vendibles") q = q.eq("es_vendible", true);
  if (filtro === "insumos") q = q.eq("es_insumo", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}
