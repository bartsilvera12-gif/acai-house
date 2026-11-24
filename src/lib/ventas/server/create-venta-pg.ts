import { randomUUID } from "node:crypto";
import { createServiceRoleClientWithDbSchema } from "@/lib/supabase/empresa-data-schema";
import { convertirCantidad } from "@/lib/unidades/convert";
import { consumoAutoInsumosActivo } from "@/lib/inventario/consumo-auto-flag";

/** Un faltante de stock detectado al validar la venta. */
export interface FaltanteStock {
  tipo: "producto" | "insumo";
  producto_id: string;
  nombre: string;
  sku: string;
  stock_actual: number;
  solicitado: number;
  faltante: number;
}

/**
 * Se lanza cuando falta stock y NO se autorizó la venta sin stock
 * (`permitir_sin_stock` ausente/false). Lleva el detalle para que la UI
 * muestre el modal de confirmación y reintente con el flag.
 */
export class StockInsuficienteError extends Error {
  faltantes: FaltanteStock[];
  constructor(faltantes: FaltanteStock[]) {
    super("Stock insuficiente para uno o más productos/insumos.");
    this.name = "StockInsuficienteError";
    this.faltantes = faltantes;
  }
}

export interface CreateVentaItemAdicionalInput {
  /** Catalog id (acaihouse.adicionales.id). Puede quedar null si fuera ad-hoc; hoy siempre viene. */
  adicional_id: string | null;
  /** Snapshot de nombre al momento de vender. */
  nombre: string;
  /** Precio unitario en Gs. (ya convertido si la venta era USD). */
  precio_unitario: number;
  /** Veces que se aplica el adicional a la línea. Hoy siempre 1 desde la UI. */
  cantidad?: number;
}

export interface CreateVentaItemVarianteInput {
  /** FK a receta_grupos_variante.id — identifica el grupo (chocolate/bis/oreo) */
  grupo_id: string;
  /** FK a receta_grupo_opciones.id — la opción elegida por el cliente (snapshot aparte) */
  opcion_id: string;
}

export interface CreateVentaItemInput {
  producto_id: string;
  producto_nombre: string;
  sku: string;
  cantidad: number;
  precio_venta_original: number;
  precio_venta: number;
  tipo_iva: "EXENTA" | "5%" | "10%";
  tipo_precio: "minorista" | "mayorista" | "distribuidor" | "costo";
  subtotal: number;
  monto_iva: number;
  total_linea: number;
  /** Variación/nota para la cocina (ej: "sin leche condensada"). Opcional. */
  nota?: string | null;
  /** Presentación/tamaño elegido (FK a producto_presentaciones). Null = sin presentaciones. */
  presentacion_id?: string | null;
  /** Adicionales aplicados a esta línea (se insertan como filas hijas en venta_item_adicionales). */
  adicionales?: CreateVentaItemAdicionalInput[];
  /**
   * Fase 2.2 Parte 4: variantes elegidas por el cliente en los grupos obligatorios
   * de la receta activa. La selección NO modifica el precio. Se persiste snapshot
   * inmutable en venta_item_variantes y se descuenta stock del insumo elegido
   * cuando el consumo automático está activo.
   */
  variantes_elegidas?: CreateVentaItemVarianteInput[];
}

export interface CreateVentaPedidoCocinaInput {
  modalidad: "local" | "delivery" | "carry_out";
  mesa: string | null;
  cliente_nombre: string | null;
  cliente_telefono: string | null;
  direccion_entrega: string | null;
  observacion: string | null;
}

export interface CreateVentaPgParams {
  schema: string;
  empresaId: string;
  clienteId: string | null;
  observaciones: string | null;
  moneda: "GS" | "USD";
  tipoCambio: number;
  tipoVenta: "CONTADO" | "CREDITO";
  plazoDias: number | null;
  /** Fecha de vencimiento explícita (YYYY-MM-DD) para crédito. Si falta, se calcula con plazoDias. */
  fechaVencimiento?: string | null;
  metodoPago: "efectivo" | "tarjeta" | "transferencia" | null;
  items: CreateVentaItemInput[];
  subtotalDeclarado: number;
  montoIvaDeclarado: number;
  totalDeclarado: number;
  pedidoCocina?: CreateVentaPedidoCocinaInput | null;
  /** Si true, autoriza vender aunque falte stock de productos o insumos (stock puede quedar negativo). */
  permitirSinStock?: boolean;
  /** Si true y hay cliente, la venta emite nota de remisión (documento NO fiscal) con número NR-XXXXXX. */
  generaNotaRemision?: boolean;
  /** UUID auth.users.id del operador que crea la venta (audit en movimientos.created_by). */
  createdBy?: string | null;
  /** Nombre legible del operador (cache para mostrar en movimientos sin join). */
  usuarioNombre?: string | null;
  /** UUID de la caja abierta a la que pertenece esta venta (arqueo). Null si no hay caja. */
  cajaId?: string | null;
}

function recalcTotals(items: CreateVentaItemInput[]) {
  let subtotal = 0;
  let montoIva = 0;
  let total = 0;
  for (const it of items) {
    subtotal += it.subtotal;
    montoIva += it.monto_iva;
    total += it.total_linea;
  }
  return { subtotal, montoIva, total };
}

const TOL = 2;

/**
 * Crea venta + ítems + movimientos + descuenta stock vía PostgREST/service-role.
 * Sin pool PG directo → compatible con Hostinger Node.js App.
 *
 * Atomicidad: PostgREST no expone transacciones multi-statement. Se hace best-effort:
 * si algún paso post-venta falla, se intenta rollback eliminando venta+items creados.
 * Para una instancia gastronómica de bajo volumen es aceptable.
 *
 * Regla `controla_stock` / recetas:
 *  - Producto con receta activa (Menú elaborado): NO descuenta su propio stock; explota la
 *    receta y descuenta cada insumo/materia prima (consumo = cantidad·(1+merma_pct)/rendimiento,
 *    consistente con fn_receta_costeo), generando un movimiento SALIDA (origen 'venta', ligado por
 *    venta_id) por insumo. Valida disponibilidad de insumos.
 *  - `controla_stock=true` (Reventa, sin receta): valida stock, descuenta stock, genera movimiento.
 *  - `controla_stock=false` (Menú sin receta / servicio): se inserta en ventas_items, NO descuenta.
 */
export async function createVentaTransaccionalPg(
  params: CreateVentaPgParams
): Promise<{ ventaId: string; numeroControl: string; fechaIso: string; notaRemisionNumero: string | null; cuentaPorCobrarId?: string | null }> {
  const items = params.items;
  if (!items.length) {
    throw new Error("La venta debe tener al menos un ítem.");
  }

  const calc = recalcTotals(items);
  if (
    Math.abs(calc.subtotal - params.subtotalDeclarado) > TOL ||
    Math.abs(calc.montoIva - params.montoIvaDeclarado) > TOL ||
    Math.abs(calc.total - params.totalDeclarado) > TOL
  ) {
    throw new Error("Los totales no coinciden con los ítems; revisá el carrito.");
  }

  const qtyByProduct = new Map<string, number>();
  for (const it of items) {
    qtyByProduct.set(it.producto_id, (qtyByProduct.get(it.producto_id) ?? 0) + it.cantidad);
  }

  const sb = createServiceRoleClientWithDbSchema(params.schema);

  // ============================================================================
  // Pre-flight server-side validation para presentaciones y adicionales (Fase 1).
  // Se ejecuta ANTES de insertar venta/items para fallar sin crear basura.
  //
  // Regla de precio por línea (servidor-trusted):
  //   precio_base    = presentacion.precio (si viene presentacion_id)
  //                   | producto.precio_venta (en otro caso)
  //   precio_esperado = precio_base + Σ(adicional.precio × adicional.cantidad)
  //   Se compara contra line.precio_venta con tolerancia ±TOL Gs.
  // ============================================================================
  const presentacionIds = Array.from(
    new Set(items.map((i) => i.presentacion_id).filter((v): v is string => !!v)),
  );
  const adicionalIds = Array.from(
    new Set(
      items.flatMap((i) => (i.adicionales ?? []).map((a) => a.adicional_id).filter((v): v is string => !!v)),
    ),
  );

  interface PresentacionRow { id: string; producto_id: string; precio: number; activo: boolean; nombre: string }
  const presentacionById = new Map<string, PresentacionRow>();
  if (presentacionIds.length > 0) {
    const presQ = await sb
      .from("producto_presentaciones")
      .select("id, producto_id, precio, activo, nombre")
      .eq("empresa_id", params.empresaId)
      .in("id", presentacionIds);
    if (presQ.error) throw new Error(presQ.error.message);
    for (const r of (presQ.data ?? []) as unknown as PresentacionRow[]) {
      presentacionById.set(r.id, { ...r, precio: Number(r.precio) });
    }
    for (const pid of presentacionIds) {
      if (!presentacionById.has(pid)) {
        throw new Error(`Presentación ${pid} no existe o no pertenece a esta empresa.`);
      }
    }
  }

  // Fase 2.2: se carga también el vínculo con insumo físico para calcular descuento de stock
  // cuando el cliente paga un adicional (ej: Granola +2.000 Gs → consume N g de MP-0003).
  interface AdicionalRow {
    id: string; precio: number; activo: boolean; nombre: string;
    insumo_producto_id: string | null; insumo_cantidad: number | null; insumo_unidad: string | null;
  }
  const adicionalById = new Map<string, AdicionalRow>();
  if (adicionalIds.length > 0) {
    const adQ = await sb
      .from("adicionales")
      .select("id, precio, activo, nombre, insumo_producto_id, insumo_cantidad, insumo_unidad")
      .eq("empresa_id", params.empresaId)
      .in("id", adicionalIds);
    if (adQ.error) throw new Error(adQ.error.message);
    for (const r of (adQ.data ?? []) as unknown as AdicionalRow[]) {
      adicionalById.set(r.id, {
        ...r,
        precio: Number(r.precio),
        insumo_cantidad: r.insumo_cantidad != null ? Number(r.insumo_cantidad) : null,
      });
    }
    for (const aid of adicionalIds) {
      if (!adicionalById.has(aid)) {
        throw new Error(`Adicional ${aid} no existe o no pertenece a esta empresa.`);
      }
    }
  }

  // Lista restrictiva de adicionales por producto (si existe para alguno de los
  // productos del carrito). producto_id → Set<adicional_id permitido>.
  const productosConRestriccion = new Map<string, Set<string>>();
  if (adicionalIds.length > 0) {
    const restrQ = await sb
      .from("producto_adicionales_permitidos")
      .select("producto_id, adicional_id")
      .eq("empresa_id", params.empresaId)
      .in("producto_id", [...qtyByProduct.keys()]);
    if (restrQ.error) throw new Error(restrQ.error.message);
    for (const r of (restrQ.data ?? []) as Array<{ producto_id: string; adicional_id: string }>) {
      const set = productosConRestriccion.get(r.producto_id) ?? new Set<string>();
      set.add(r.adicional_id);
      productosConRestriccion.set(r.producto_id, set);
    }
  }

  // Por línea: validar correspondencia presentación↔producto, permiso de adicionales,
  // y recomputar precio_venta servidor-trusted.
  const productoPrecioQ = await sb
    .from("productos")
    .select("id, precio_venta")
    .eq("empresa_id", params.empresaId)
    .in("id", [...qtyByProduct.keys()]);
  if (productoPrecioQ.error) throw new Error(productoPrecioQ.error.message);
  const productoPrecioById = new Map<string, number>();
  for (const r of (productoPrecioQ.data ?? []) as Array<{ id: string; precio_venta: number | string }>) {
    productoPrecioById.set(String(r.id), Number(r.precio_venta));
  }

  for (let idx = 0; idx < items.length; idx++) {
    const line = items[idx];
    // a) Presentación pertenece al mismo producto y está activa.
    if (line.presentacion_id) {
      const pres = presentacionById.get(line.presentacion_id);
      if (!pres) throw new Error(`Presentación ${line.presentacion_id} no existe.`);
      if (!pres.activo) {
        throw new Error(`La presentación "${pres.nombre}" está inactiva y no puede venderse.`);
      }
      if (pres.producto_id !== line.producto_id) {
        throw new Error(
          `La presentación "${pres.nombre}" no pertenece al producto de la línea ${idx + 1}.`,
        );
      }
    }

    // b) Cada adicional está activo y permitido (si el producto tiene lista restrictiva).
    const permitidos = productosConRestriccion.get(line.producto_id);
    const seenInLine = new Set<string>();
    for (const ad of line.adicionales ?? []) {
      if (ad.adicional_id) {
        const cat = adicionalById.get(ad.adicional_id);
        if (!cat) throw new Error(`Adicional ${ad.adicional_id} no existe en la empresa.`);
        if (!cat.activo) {
          throw new Error(`El adicional "${cat.nombre}" está inactivo y no puede venderse.`);
        }
        if (permitidos && permitidos.size > 0 && !permitidos.has(ad.adicional_id)) {
          throw new Error(
            `El adicional "${cat.nombre}" no está permitido para este producto.`,
          );
        }
        if (seenInLine.has(ad.adicional_id)) {
          throw new Error(
            `El adicional "${cat.nombre}" aparece dos veces en la misma línea.`,
          );
        }
        seenInLine.add(ad.adicional_id);
      }
    }

    // c) Tope anti-inflación: el cajero puede DESCONTAR el precio base (comportamiento
    //    histórico del ERP: el input de precio es libre en caja), pero NO puede inflarlo
    //    por encima del tope de catálogo. Calculamos el tope servidor-trusted:
    //      max = precio_base_catalogo (presentación o producto) + Σ(adicional.precio × cantidad)
    //    `line.precio_venta` incluye los adicionales (el front los suma al unitario).
    //    Si excede el tope por más de TOL Gs. → rechazar (anti-fraude), si no, aceptar.
    //    En USD no validamos (la conversión la hace el cliente con TC).
    if (params.moneda === "GS") {
      const precioBaseEsperado = line.presentacion_id
        ? presentacionById.get(line.presentacion_id)!.precio
        : productoPrecioById.get(line.producto_id);
      if (precioBaseEsperado == null) {
        throw new Error(`Producto ${line.producto_id} no tiene precio registrado.`);
      }
      const sumaAdicionalesCatalogo = (line.adicionales ?? []).reduce((acc, ad) => {
        const cantAd = ad.cantidad && ad.cantidad > 0 ? Math.floor(ad.cantidad) : 1;
        const precioAd = ad.adicional_id
          ? adicionalById.get(ad.adicional_id)!.precio
          : Number(ad.precio_unitario);
        return acc + precioAd * cantAd;
      }, 0);
      const techo = precioBaseEsperado + sumaAdicionalesCatalogo;
      if (line.precio_venta - techo > TOL) {
        throw new Error(
          `El precio de la línea ${idx + 1} supera el tope de catálogo. ` +
            `Máximo Gs. ${Math.round(techo)}, recibido Gs. ${Math.round(line.precio_venta)}.`,
        );
      }
    }
  }

  // 1) Cliente
  if (params.clienteId) {
    const ck = await sb.from("clientes").select("id").eq("id", params.clienteId).eq("empresa_id", params.empresaId).maybeSingle();
    if (ck.error) throw new Error(ck.error.message);
    if (!ck.data) throw new Error("Cliente no encontrado en esta empresa.");
  }

  // 2) Cargar productos del carrito — TODOS los que existan y pertenezcan a la empresa, sin filtrar controla_stock ni stock>0.
  const ids = [...qtyByProduct.keys()];
  const prodQ = await sb
    .from("productos")
    .select("id, stock_actual, costo_promedio, nombre, sku, controla_stock, modo_receta")
    .eq("empresa_id", params.empresaId)
    .in("id", ids);
  if (prodQ.error) throw new Error(prodQ.error.message);
  const prodRows = (prodQ.data ?? []) as unknown as Array<{
    id: string;
    stock_actual: number | string;
    costo_promedio: number | string;
    nombre: string;
    sku: string;
    controla_stock: boolean | null;
    modo_receta: string | null;
  }>;

  if (prodRows.length !== ids.length) {
    const found = new Set(prodRows.map((r) => r.id));
    const faltantes = ids.filter((id) => !found.has(id));
    throw new Error(
      `Uno o más productos no existen o no pertenecen a esta empresa. IDs no encontrados: ${faltantes.join(", ")}`
    );
  }

  type ProdMeta = { stock: number; costo: number; nombre: string; sku: string; controlaStock: boolean; modo: string };
  const stockMap = new Map<string, ProdMeta>();
  for (const r of prodRows) {
    stockMap.set(r.id, {
      stock: Number(r.stock_actual),
      costo: Number(r.costo_promedio),
      nombre: r.nombre,
      sku: r.sku,
      controlaStock: r.controla_stock !== false,
      modo: r.modo_receta ?? "preparado_al_vender",
    });
  }

  // Fase 2.2: feature flag — si la empresa tiene el consumo automático desactivado,
  // saltamos la carga de recetas y el descuento de insumos (tanto por receta como por
  // adicional). El stock propio de productos (controla_stock=true) sigue funcionando.
  const consumoInsumosActivo = consumoAutoInsumosActivo(params.empresaId);

  // 2b) Recetas: para cada línea vendida (producto + presentación), calcular el consumo de
  //     materia prima (insumos). Consistente con el costeo (fn_receta_costeo):
  //     consumo por unidad vendida = cantidad * (1 + merma_pct) / rendimiento.
  //
  // Fase 2.2: selección de receta por (producto_id, presentacion_id). Políticas:
  //  - Si la línea envía presentacion_id → busca EXACTA (producto_id, presentacion_id).
  //    Si no existe, cae a la receta base (presentacion_id IS NULL) solo si es la única activa.
  //    Si tampoco existe → no se descuenta nada por receta (modo legacy).
  //  - Si la línea NO envía presentacion_id → usa receta base (presentacion_id IS NULL).
  //    Si el producto tiene recetas por presentación activas pero la venta no indica cuál,
  //    NO se descuenta (evita descontar la receta equivocada).
  // Fase 2.2 Parte 4: cargar recetas SIEMPRE (no solo cuando el consumo auto
  // está activo). La validación de variantes obligatorias y la persistencia de
  // su snapshot (venta_item_variantes) son parte del REGISTRO de la venta y
  // deben ocurrir con independencia del flag. Solo el DESCUENTO de stock de
  // insumos queda gateado por `consumoInsumosActivo` (ver bloques más abajo).
  const recetasQ = await sb
    .from("recetas")
    .select("id, producto_id, presentacion_id, rendimiento_cantidad")
    .eq("empresa_id", params.empresaId)
    .eq("activa", true)
    .in("producto_id", ids);
  if (recetasQ.error) throw new Error(recetasQ.error.message);
  const recetaRows = (recetasQ.data ?? []) as unknown as Array<{
    id: string;
    producto_id: string;
    presentacion_id: string | null;
    rendimiento_cantidad: number | string | null;
  }>;
  if (!consumoInsumosActivo) {
    console.info(`[create-venta-pg] consumo automático de insumos DESACTIVADO para empresa ${params.empresaId} — solo stock de productos propios se descontará.`);
  }

  // Index: producto_id -> { base: receta|undefined, byPresentacion: Map<presentacion_id, receta> }
  type RecetaIdx = { id: string; rendimiento: number };
  const recetasByProducto = new Map<string, { base?: RecetaIdx; byPresentacion: Map<string, RecetaIdx> }>();
  for (const r of recetaRows) {
    const modo = stockMap.get(r.producto_id)?.modo ?? "preparado_al_vender";
    if (modo === "produccion_previa") continue; // ver comentario abajo
    const rend = Number(r.rendimiento_cantidad);
    const entry = { id: r.id, rendimiento: rend > 0 ? rend : 1 };
    let idx = recetasByProducto.get(r.producto_id);
    if (!idx) { idx = { byPresentacion: new Map() }; recetasByProducto.set(r.producto_id, idx); }
    if (r.presentacion_id) idx.byPresentacion.set(r.presentacion_id, entry);
    else idx.base = entry;
  }

  // Selección final por línea de venta. Mapea producto_id -> receta elegida.
  // IMPORTANTE: la unicidad DB (unique parcial WHERE activa=true) garantiza que no haya dos
  // recetas activas para la misma (producto, presentación). Pero dos líneas del mismo producto
  // con distinta presentación pueden coexistir — se procesan por línea en el bloque siguiente.
  //
  // Solo se explota la receta (descuento de materia prima al vender) para productos en modo
  // 'preparado_al_vender'. Los productos 'produccion_previa' descuentan su PROPIO stock del
  // terminado (la materia prima ya se descontó al fabricar) → NO se agregan acá, así caen en
  // la rama de descuento de stock propio (pasos 3a/7). Evita el doble descuento.
  //
  // Para compatibilidad con el map `recetaByProducto` usado aguas abajo cuando NO hay múltiples
  // presentaciones por producto, mantenemos un map "simple" cuando la línea no distingue
  // presentación. Para el caso con presentación, se arma un map por línea.
  const recetaByProducto = new Map<string, { id: string; rendimiento: number }>();
  for (const [pid, idx] of recetasByProducto) {
    // Default conservador: si el producto tiene presentaciones con receta, NO poblar el map
    // "por producto" (las líneas con presentacion_id usarán el byPresentacion; las que no
    // tengan presentacion_id tampoco deben caer en receta ajena → no se descuenta).
    if (idx.byPresentacion.size > 0) continue;
    if (idx.base) recetaByProducto.set(pid, idx.base);
  }

  // insumo_producto_id -> cantidad total a descontar en esta venta (EN LA UNIDAD DEL INSUMO).
  const insumoNeed = new Map<string, number>();
  // Metadata de insumos (stock/costo/nombre/sku/unidad) para validar y registrar movimientos.
  type InsumoMeta = { stock: number; costo: number; nombre: string; sku: string; unidad: string | null };
  const insumoMeta = new Map<string, InsumoMeta>();
  // Ítems cuya unidad es incompatible con la del insumo (no se convierten ni descuentan).
  const insumosIncompatibles: string[] = [];

  if (recetaRows.length) {
    const recetaIds = recetaRows.map((r) => r.id);
    const itemsQ = await sb
      .from("receta_items")
      .select("receta_id, insumo_producto_id, cantidad, unidad_medida, merma_pct")
      .in("receta_id", recetaIds);
    if (itemsQ.error) throw new Error(itemsQ.error.message);
    const itemsByReceta = new Map<string, Array<{ insumo_producto_id: string; cantidad: number; unidad_item: string | null; merma_pct: number }>>();
    const insumoIdsSet = new Set<string>();
    for (const it of (itemsQ.data ?? []) as unknown as Array<{
      receta_id: string;
      insumo_producto_id: string;
      cantidad: number | string;
      unidad_medida: string | null;
      merma_pct: number | string | null;
    }>) {
      const arr = itemsByReceta.get(it.receta_id) ?? [];
      arr.push({
        insumo_producto_id: it.insumo_producto_id,
        cantidad: Number(it.cantidad),
        unidad_item: it.unidad_medida ?? null,
        merma_pct: Number(it.merma_pct ?? 0),
      });
      itemsByReceta.set(it.receta_id, arr);
      insumoIdsSet.add(it.insumo_producto_id);
    }

    // Cargar meta de insumos (incluida su unidad) ANTES de agregar, para poder convertir.
    const insumoIds = [...insumoIdsSet];
    if (insumoIds.length) {
      const insQ = await sb
        .from("productos")
        .select("id, stock_actual, costo_promedio, nombre, sku, unidad_medida")
        .eq("empresa_id", params.empresaId)
        .in("id", insumoIds);
      if (insQ.error) throw new Error(insQ.error.message);
      const insRows = (insQ.data ?? []) as unknown as Array<{
        id: string;
        stock_actual: number | string;
        costo_promedio: number | string;
        nombre: string;
        sku: string;
        unidad_medida: string | null;
      }>;
      if (insRows.length !== insumoIds.length) {
        const found = new Set(insRows.map((r) => r.id));
        const faltan = insumoIds.filter((i) => !found.has(i));
        throw new Error(`La receta referencia insumos inexistentes en esta empresa: ${faltan.join(", ")}`);
      }
      for (const r of insRows) {
        insumoMeta.set(r.id, {
          stock: Number(r.stock_actual),
          costo: Number(r.costo_promedio),
          nombre: r.nombre,
          sku: r.sku,
          unidad: r.unidad_medida ?? null,
        });
      }
    }

    // Agregar consumo POR LÍNEA. Fase 2.2 Parte 4: el descuento de insumos por
    // receta BASE queda gateado por el flag; la validación de variantes y el
    // snapshot (bloque siguiente) NO dependen del flag.
    if (consumoInsumosActivo) {
      const recetasSinCobertura: string[] = []; // líneas que no encontraron receta para su presentación
      for (const line of params.items) {
        const pid = line.producto_id;
        const idx = recetasByProducto.get(pid);
        if (!idx) continue;
        let rec: RecetaIdx | undefined;
        if (line.presentacion_id) {
          rec = idx.byPresentacion.get(line.presentacion_id);
          if (!rec) {
            if (idx.byPresentacion.size === 0 && idx.base) rec = idx.base;
          }
        } else {
          if (idx.byPresentacion.size === 0 && idx.base) rec = idx.base;
        }
        if (!rec) {
          const nombre = stockMap.get(pid)?.nombre ?? pid;
          if (!recetasSinCobertura.includes(nombre)) recetasSinCobertura.push(nombre);
          continue;
        }
        const qtySold = Number(line.cantidad) || 0;
        if (!(qtySold > 0)) continue;
        for (const ri of itemsByReceta.get(rec.id) ?? []) {
          const meta = insumoMeta.get(ri.insumo_producto_id);
          const unidadInsumo = meta?.unidad ?? null;
          const cantConv = (ri.unidad_item == null || unidadInsumo == null)
            ? ri.cantidad
            : convertirCantidad(ri.cantidad, ri.unidad_item, unidadInsumo);
          if (cantConv == null) {
            const nombre = meta?.nombre ?? ri.insumo_producto_id;
            if (!insumosIncompatibles.includes(nombre)) insumosIncompatibles.push(nombre);
            continue;
          }
          const consumo = (qtySold * cantConv * (1 + ri.merma_pct)) / rec.rendimiento;
          if (!(consumo > 0)) continue;
          insumoNeed.set(ri.insumo_producto_id, (insumoNeed.get(ri.insumo_producto_id) ?? 0) + consumo);
        }
      }
      if (recetasSinCobertura.length > 0) {
        console.warn("[create-venta-pg] presentaciones vendidas sin receta específica (no descuentan insumos):",
          recetasSinCobertura.join(", "));
      }
    }
  }

  // ───────── Fase 2.2 Parte 4: variantes obligatorias de receta ─────────
  // Carga de grupos de variantes + opciones para todas las recetas que aplican
  // a alguna línea. Valida:
  //   · toda receta con grupos obligatorios recibe la selección completa en la línea;
  //   · grupos no duplicados por línea; opción pertenece al grupo declarado;
  //   · ningún grupo-opción "cruzado" (otro producto/presentación).
  // Agrega al `insumoNeed` el consumo de la opción elegida (misma lógica de
  // conversión y merma que los items base). Guarda `variantesSnapshotPorLinea`
  // para persistirlo como snapshot inmutable después del INSERT de ventas_items.
  type GrupoRow = { id: string; receta_id: string; codigo: string; etiqueta: string; obligatorio: boolean; orden: number };
  type OpcionRow = { id: string; grupo_id: string; insumo_producto_id: string; cantidad: number; unidad_medida: string; merma_pct: number; etiqueta: string };
  type VarianteSnapshot = {
    grupo_id: string;
    opcion_id: string;
    grupo_codigo: string;
    grupo_etiqueta: string;
    opcion_etiqueta: string;
    insumo_producto_id: string;
    insumo_sku: string;
    insumo_nombre: string;
    cantidad: number;
    unidad_medida: string;
    merma_pct: number;
    /** Costo histórico del insumo al momento de la venta (snapshot inmutable). */
    costo_unitario_snapshot: number;
  };
  const gruposPorReceta = new Map<string, Array<GrupoRow & { opciones: Map<string, OpcionRow> }>>();
  const variantesSnapshotPorLinea: VarianteSnapshot[][] = params.items.map(() => []);
  if (recetaRows.length) {
    const recetaIdsForGrupos = recetaRows.map((r) => r.id);
    const gq = await sb
      .from("receta_grupos_variante")
      .select("id, receta_id, codigo, etiqueta, obligatorio, orden")
      .eq("empresa_id", params.empresaId)
      .in("receta_id", recetaIdsForGrupos);
    if (gq.error) throw new Error(gq.error.message);
    const grupos = (gq.data ?? []) as unknown as GrupoRow[];
    if (grupos.length > 0) {
      const grupoIds = grupos.map((g) => g.id);
      const oq = await sb
        .from("receta_grupo_opciones")
        .select("id, grupo_id, insumo_producto_id, cantidad, unidad_medida, merma_pct, etiqueta")
        .eq("empresa_id", params.empresaId)
        .in("grupo_id", grupoIds);
      if (oq.error) throw new Error(oq.error.message);
      const opcionesPorGrupo = new Map<string, Map<string, OpcionRow>>();
      for (const row of (oq.data ?? []) as unknown as OpcionRow[]) {
        const rowNorm: OpcionRow = {
          ...row,
          cantidad: Number(row.cantidad),
          merma_pct: Number(row.merma_pct ?? 0),
        };
        const mp = opcionesPorGrupo.get(row.grupo_id) ?? new Map<string, OpcionRow>();
        mp.set(row.id, rowNorm);
        opcionesPorGrupo.set(row.grupo_id, mp);
      }
      for (const g of grupos) {
        const arr = gruposPorReceta.get(g.receta_id) ?? [];
        arr.push({ ...g, opciones: opcionesPorGrupo.get(g.id) ?? new Map() });
        gruposPorReceta.set(g.receta_id, arr);
      }
      // Cargar meta de los insumos de variantes (puede haber ids nuevos no incluidos
      // en insumoMeta — los que solo aparecen como opción, no como receta_item).
      const varInsumoIds = new Set<string>();
      for (const mp of opcionesPorGrupo.values()) for (const op of mp.values()) {
        if (!insumoMeta.has(op.insumo_producto_id)) varInsumoIds.add(op.insumo_producto_id);
      }
      if (varInsumoIds.size > 0) {
        const insQV = await sb
          .from("productos")
          .select("id, stock_actual, costo_promedio, nombre, sku, unidad_medida")
          .eq("empresa_id", params.empresaId)
          .in("id", [...varInsumoIds]);
        if (insQV.error) throw new Error(insQV.error.message);
        for (const r of (insQV.data ?? []) as unknown as Array<{
          id: string; stock_actual: number | string; costo_promedio: number | string;
          nombre: string; sku: string; unidad_medida: string | null;
        }>) {
          insumoMeta.set(r.id, {
            stock: Number(r.stock_actual), costo: Number(r.costo_promedio),
            nombre: r.nombre, sku: r.sku, unidad: r.unidad_medida ?? null,
          });
        }
      }

      // Validación por línea + consumo + snapshot.
      for (let i = 0; i < params.items.length; i++) {
        const line = params.items[i]!;
        const pid = line.producto_id;
        const idx = recetasByProducto.get(pid);
        if (!idx) {
          if ((line.variantes_elegidas ?? []).length > 0) {
            throw new Error(`Línea ${i + 1} (${line.producto_nombre}): no tiene receta, no debe enviar variantes.`);
          }
          continue;
        }
        let rec: RecetaIdx | undefined;
        if (line.presentacion_id) {
          rec = idx.byPresentacion.get(line.presentacion_id) ?? (idx.byPresentacion.size === 0 ? idx.base : undefined);
        } else if (idx.byPresentacion.size === 0) {
          rec = idx.base;
        }
        if (!rec) {
          if ((line.variantes_elegidas ?? []).length > 0) {
            throw new Error(`Línea ${i + 1}: la presentación vendida no tiene receta, no se pueden mandar variantes.`);
          }
          continue;
        }
        const gruposDeReceta = gruposPorReceta.get(rec.id) ?? [];
        const obligatorios = gruposDeReceta.filter((g) => g.obligatorio);
        const seleccion = line.variantes_elegidas ?? [];

        // Grupos duplicados en la misma línea.
        const seenGrupo = new Set<string>();
        for (const v of seleccion) {
          if (seenGrupo.has(v.grupo_id)) {
            throw new Error(`Línea ${i + 1}: grupo repetido en la selección de variantes.`);
          }
          seenGrupo.add(v.grupo_id);
        }
        // Toda selección debe apuntar a un grupo+opción de ESTA receta.
        const grupoById = new Map(gruposDeReceta.map((g) => [g.id, g]));
        for (const v of seleccion) {
          const g = grupoById.get(v.grupo_id);
          if (!g) {
            throw new Error(`Línea ${i + 1}: grupo ${v.grupo_id} no pertenece a la receta "${rec.id}".`);
          }
          const op = g.opciones.get(v.opcion_id);
          if (!op) {
            throw new Error(`Línea ${i + 1} (${g.etiqueta}): opción ${v.opcion_id} no pertenece al grupo.`);
          }
        }
        // Todos los grupos obligatorios tienen que estar presentes.
        for (const g of obligatorios) {
          const hit = seleccion.find((v) => v.grupo_id === g.id);
          if (!hit) {
            throw new Error(`Línea ${i + 1} (${line.producto_nombre}): falta elegir "${g.etiqueta}".`);
          }
        }

        // Consumo + snapshot.
        const qtySold = Number(line.cantidad) || 0;
        for (const v of seleccion) {
          const g = grupoById.get(v.grupo_id)!;
          const op = g.opciones.get(v.opcion_id)!;
          const meta = insumoMeta.get(op.insumo_producto_id);
          if (!meta) throw new Error(`Línea ${i + 1} (${g.etiqueta}): insumo de la opción no existe o no es accesible.`);
          variantesSnapshotPorLinea[i]!.push({
            grupo_id: g.id,
            opcion_id: op.id,
            grupo_codigo: g.codigo,
            grupo_etiqueta: g.etiqueta,
            opcion_etiqueta: op.etiqueta,
            insumo_producto_id: op.insumo_producto_id,
            insumo_sku: meta.sku,
            insumo_nombre: meta.nombre,
            cantidad: op.cantidad,
            unidad_medida: op.unidad_medida,
            merma_pct: op.merma_pct,
            // Capturamos costo del insumo al momento de la venta. Es el costo
            // histórico — si después cambia productos.costo_promedio, esta
            // fila queda con el valor del día de la venta.
            costo_unitario_snapshot: meta.costo,
          });
          if (consumoInsumosActivo && qtySold > 0) {
            const unidadInsumo = meta.unidad;
            const cantConv = (unidadInsumo == null || !op.unidad_medida)
              ? op.cantidad
              : convertirCantidad(op.cantidad, op.unidad_medida, unidadInsumo);
            if (cantConv == null) {
              if (!insumosIncompatibles.includes(meta.nombre)) insumosIncompatibles.push(meta.nombre);
              continue;
            }
            const consumo = (qtySold * cantConv * (1 + op.merma_pct)) / rec.rendimiento;
            if (consumo > 0) {
              insumoNeed.set(op.insumo_producto_id, (insumoNeed.get(op.insumo_producto_id) ?? 0) + consumo);
            }
          }
        }
      }
    } else {
      // No hay grupos declarados para ninguna receta activa — las líneas no deben traer variantes.
      for (let i = 0; i < params.items.length; i++) {
        if ((params.items[i]!.variantes_elegidas ?? []).length > 0) {
          throw new Error(`Línea ${i + 1}: la receta no define grupos de variante.`);
        }
      }
    }
  }

  // Fase 2.2: consumo de insumos por adicionales comerciales vendidos.
  // Si un adicional tiene insumo_producto_id + insumo_cantidad configurados, descuenta
  // cantidad × line.cantidad × ad.cantidad del insumo correspondiente.
  // Reutiliza `insumoMeta` para unidad/stock/costo. Si falta meta (insumo nuevo), se carga.
  // Respeta el feature flag: si está off, salta todo el bloque.
  if (!consumoInsumosActivo) {
    // Early skip — el map insumoNeed se mantiene vacío y step 3b/7 no harán nada.
    // Dejamos el flujo continuar hacia el cálculo de totales y descuento de stock propio.
  }
  const extraInsumoIds = new Set<string>();
  if (consumoInsumosActivo) {
    for (const line of params.items) {
      for (const ad of line.adicionales ?? []) {
        if (!ad.adicional_id) continue;
        const cat = adicionalById.get(ad.adicional_id);
        if (!cat?.insumo_producto_id) continue;
        if (!insumoMeta.has(cat.insumo_producto_id)) extraInsumoIds.add(cat.insumo_producto_id);
      }
    }
  }
  if (extraInsumoIds.size > 0) {
    const insQ2 = await sb
      .from("productos")
      .select("id, stock_actual, costo_promedio, nombre, sku, unidad_medida")
      .eq("empresa_id", params.empresaId)
      .in("id", [...extraInsumoIds]);
    if (insQ2.error) throw new Error(insQ2.error.message);
    for (const r of (insQ2.data ?? []) as unknown as Array<{
      id: string; stock_actual: number | string; costo_promedio: number | string;
      nombre: string; sku: string; unidad_medida: string | null;
    }>) {
      insumoMeta.set(r.id, {
        stock: Number(r.stock_actual), costo: Number(r.costo_promedio),
        nombre: r.nombre, sku: r.sku, unidad: r.unidad_medida ?? null,
      });
    }
  }
  if (consumoInsumosActivo) {
    for (const line of params.items) {
      const qtyLinea = Number(line.cantidad) || 0;
      if (!(qtyLinea > 0)) continue;
      for (const ad of line.adicionales ?? []) {
        if (!ad.adicional_id) continue;
        const cat = adicionalById.get(ad.adicional_id);
        if (!cat?.insumo_producto_id || !(cat.insumo_cantidad != null && cat.insumo_cantidad > 0)) continue;
        const meta = insumoMeta.get(cat.insumo_producto_id);
        if (!meta) continue;
        const unidadInsumo = meta.unidad;
        const unidadAd = cat.insumo_unidad ?? unidadInsumo;
        const cantConv = (unidadAd == null || unidadInsumo == null)
          ? cat.insumo_cantidad
          : convertirCantidad(cat.insumo_cantidad, unidadAd, unidadInsumo);
        if (cantConv == null) {
          if (!insumosIncompatibles.includes(meta.nombre)) insumosIncompatibles.push(meta.nombre);
          continue;
        }
        const porcionesAd = Number(ad.cantidad ?? 1) || 1;
        const consumo = qtyLinea * porcionesAd * cantConv;
        if (!(consumo > 0)) continue;
        insumoNeed.set(cat.insumo_producto_id, (insumoNeed.get(cat.insumo_producto_id) ?? 0) + consumo);
      }
    }
  }
  // Redondeo a 6 decimales para evitar ruido de coma flotante (la columna es numeric sin escala).
  for (const [k, v] of insumoNeed) insumoNeed.set(k, Math.round(v * 1e6) / 1e6);
  if (insumosIncompatibles.length > 0) {
    console.warn("[create-venta-pg] receta con unidades incompatibles (no se descuentan):", insumosIncompatibles.join(", "));
  }

  // 3) Validar stock. Se recolectan TODOS los faltantes (productos de reventa con receta
  //    consumen insumos, no su propio stock). Si hay faltantes y NO se autorizó la venta sin
  //    stock, se lanza StockInsuficienteError con el detalle (la UI muestra el modal y reintenta
  //    con permitir_sin_stock=true). Si se autorizó, se continúa y el stock puede quedar negativo.
  const faltantes: FaltanteStock[] = [];

  // 3a) Productos de reventa (controla_stock=true, sin receta).
  for (const [pid, need] of qtyByProduct) {
    const p = stockMap.get(pid)!;
    // Fase 2.2: si el producto tiene CUALQUIER receta activa (base o por presentación),
    // el stock se controla a través de los insumos → saltar.
    if (recetasByProducto.has(pid)) continue;
    // produccion_previa: descuenta su propio stock del terminado aunque controla_stock=false.
    if (!p.controlaStock && p.modo !== "produccion_previa") continue;
    if (p.stock < need) {
      faltantes.push({
        tipo: "producto", producto_id: pid, nombre: p.nombre, sku: p.sku,
        stock_actual: p.stock, solicitado: need, faltante: Math.round((need - p.stock) * 1e6) / 1e6,
      });
    }
  }

  // 3b) Materia prima (insumos) requerida por las recetas.
  for (const [insId, need] of insumoNeed) {
    const m = insumoMeta.get(insId)!;
    if (m.stock < need) {
      faltantes.push({
        tipo: "insumo", producto_id: insId, nombre: m.nombre, sku: m.sku,
        stock_actual: m.stock, solicitado: need, faltante: Math.round((need - m.stock) * 1e6) / 1e6,
      });
    }
  }

  if (faltantes.length > 0 && !params.permitirSinStock) {
    throw new StockInsuficienteError(faltantes);
  }

  // Auditoría: si se autorizó vender sin stock y hubo faltantes, dejar constancia en la venta.
  let observacionesFinal = params.observaciones;
  if (faltantes.length > 0 && params.permitirSinStock) {
    const detalle = faltantes
      .map((f) => `${f.nombre} (stock ${f.stock_actual}, pedido ${f.solicitado}, falta ${f.faltante})`)
      .join("; ");
    const nota = `Venta con stock insuficiente autorizada: ${detalle}`;
    observacionesFinal = (observacionesFinal ? `${observacionesFinal} | ${nota}` : nota).slice(0, 4000);
  }

  // 4) Numero control VTA-XXXXXX (best-effort: race posible en entorno multi-usuario).
  const maxQ = await sb
    .from("ventas")
    .select("numero_control")
    .eq("empresa_id", params.empresaId)
    .like("numero_control", "VTA-%")
    .order("numero_control", { ascending: false })
    .limit(1);
  if (maxQ.error) throw new Error(maxQ.error.message);
  let nextNum = 1;
  const lastNum = (maxQ.data?.[0] as { numero_control?: string } | undefined)?.numero_control;
  if (lastNum) {
    const m = lastNum.match(/^VTA-(\d+)$/);
    if (m) nextNum = parseInt(m[1], 10) + 1;
  }
  const numeroControl = `VTA-${String(nextNum).padStart(6, "0")}`;
  const fechaIso = new Date().toISOString();

  // 4b) Nota de remisión (solo si se solicita Y hay cliente). Numeración simple por
  //     empresa: NR-XXXXXX. Documento NO fiscal — no toca SIFEN/timbrado.
  const generaNota = params.generaNotaRemision === true && !!params.clienteId;
  let notaRemisionNumero: string | null = null;
  if (generaNota) {
    const nrQ = await sb
      .from("ventas")
      .select("nota_remision_numero")
      .eq("empresa_id", params.empresaId)
      .like("nota_remision_numero", "NR-%")
      .order("nota_remision_numero", { ascending: false })
      .limit(1);
    if (nrQ.error) throw new Error(nrQ.error.message);
    let nextNr = 1;
    const lastNr = (nrQ.data?.[0] as { nota_remision_numero?: string } | undefined)?.nota_remision_numero;
    if (lastNr) {
      const m = lastNr.match(/^NR-(\d+)$/);
      if (m) nextNr = parseInt(m[1], 10) + 1;
    }
    notaRemisionNumero = `NR-${String(nextNr).padStart(6, "0")}`;
  }

  // 5) Insertar venta
  const insVenta = await sb
    .from("ventas")
    .insert({
      empresa_id: params.empresaId,
      cliente_id: params.clienteId,
      numero_control: numeroControl,
      moneda: params.moneda,
      tipo_cambio: params.tipoCambio,
      subtotal: calc.subtotal,
      monto_iva: calc.montoIva,
      total: calc.total,
      estado: "completada",
      tipo_venta: params.tipoVenta,
      plazo_dias: params.plazoDias,
      metodo_pago: params.metodoPago,
      genera_nota_remision: generaNota,
      nota_remision_numero: notaRemisionNumero,
      fecha: fechaIso,
      observaciones: observacionesFinal,
      caja_id: params.cajaId ?? null,
    })
    .select("id")
    .single();
  if (insVenta.error) throw new Error(insVenta.error.message);
  const ventaId = String((insVenta.data as { id: string }).id);

  // Helper de rollback best-effort.
  // IMPORTANTE: borramos venta_item_adicionales explícitamente antes que ventas_items
  // (el CASCADE lo cubriría igual, pero preferimos borrado dirigido por si en el
  // futuro la FK cambia de modo).
  const rollback = async () => {
    try {
      await sb.from("cuentas_por_cobrar").delete().eq("venta_id", ventaId).eq("empresa_id", params.empresaId);
    } catch {}
    try {
      await sb.from("movimientos_inventario").delete().eq("venta_id", ventaId).eq("empresa_id", params.empresaId);
    } catch {}
    // Hijos de ventas_items: usamos los ids pre-generados (orden-independiente
    // y disponibles aunque el insert haya fallado a mitad de camino).
    try {
      if (preGeneratedItemIds.length > 0) {
        await sb
          .from("venta_item_adicionales")
          .delete()
          .eq("empresa_id", params.empresaId)
          .in("venta_item_id", preGeneratedItemIds);
      }
    } catch {}
    try {
      if (preGeneratedItemIds.length > 0) {
        await sb
          .from("venta_item_variantes")
          .delete()
          .eq("empresa_id", params.empresaId)
          .in("venta_item_id", preGeneratedItemIds);
      }
    } catch {}
    try {
      await sb.from("ventas_items").delete().eq("venta_id", ventaId).eq("empresa_id", params.empresaId);
    } catch {}
    try {
      await sb.from("ventas").delete().eq("id", ventaId).eq("empresa_id", params.empresaId);
    } catch {}
  };

  // Pre-generar los UUIDs de ventas_items.id ANTES del insert. De esta forma:
  //   1) la asociación línea → item_id es inequívoca (no dependemos del orden
  //      en que PostgREST devuelve filas, que no está garantizado);
  //   2) el rollback puede borrar venta_item_adicionales por venta_item_id aun
  //      si el insert falló antes de responder.
  const preGeneratedItemIds: string[] = items.map(() => randomUUID());

  try {
    // 6) Insertar items (bulk) con id explícito por línea.
    const itemsRows = items.map((line, i) => ({
      id: preGeneratedItemIds[i],
      empresa_id: params.empresaId,
      venta_id: ventaId,
      producto_id: line.producto_id,
      producto_nombre: line.producto_nombre,
      sku: line.sku,
      cantidad: line.cantidad,
      precio_venta_original: line.precio_venta_original,
      precio_venta: line.precio_venta,
      tipo_iva: line.tipo_iva,
      tipo_precio: line.tipo_precio,
      subtotal: line.subtotal,
      monto_iva: line.monto_iva,
      total_linea: line.total_linea,
      nota: line.nota ?? null,
      presentacion_id: line.presentacion_id ?? null,
    }));
    const insItems = await sb.from("ventas_items").insert(itemsRows);
    if (insItems.error) throw new Error(insItems.error.message);

    // 6.b) Insertar adicionales por línea. BLOQUEANTE: si falla, re-lanzamos
    //      para que el catch externo ejecute `rollback()` y la venta no quede
    //      persistida con adicionales faltantes.
    const adicionalesRows: Array<Record<string, unknown>> = [];
    items.forEach((line, i) => {
      const itemId = preGeneratedItemIds[i];
      for (const ad of line.adicionales ?? []) {
        // Snapshot (nombre+precio): si vino adicional_id, usamos nombre/precio
        // del catálogo (ya cargado y validado en el pre-flight). Si no, usamos
        // los valores del cliente (compatibilidad con adicionales ad-hoc).
        const cat = ad.adicional_id ? adicionalById.get(ad.adicional_id) : null;
        const nombre = (cat?.nombre ?? ad.nombre ?? "").trim();
        const precio = cat ? cat.precio : Number(ad.precio_unitario);
        if (!nombre || !Number.isFinite(precio) || precio < 0) {
          throw new Error(`Adicional inválido en la línea ${i + 1}.`);
        }
        adicionalesRows.push({
          empresa_id: params.empresaId,
          venta_item_id: itemId,
          adicional_id: ad.adicional_id || null,
          adicional_nombre: nombre.slice(0, 120),
          precio_unitario: precio,
          cantidad: ad.cantidad && ad.cantidad > 0 ? Math.floor(ad.cantidad) : 1,
        });
      }
    });
    if (adicionalesRows.length > 0) {
      const insAd = await sb.from("venta_item_adicionales").insert(adicionalesRows);
      if (insAd.error) {
        throw new Error(`No se pudieron registrar los adicionales: ${insAd.error.message}`);
      }
    }

    // 6.c) Insertar snapshots de variantes obligatorias elegidas por el cliente.
    //      BLOQUEANTE: cualquier error acá fuerza rollback de la venta. Los datos
    //      son snapshot inmutable (no dependen de que la opción siga existiendo).
    const variantesRows: Array<Record<string, unknown>> = [];
    items.forEach((_line, i) => {
      const itemId = preGeneratedItemIds[i];
      for (const snap of variantesSnapshotPorLinea[i] ?? []) {
        variantesRows.push({
          empresa_id: params.empresaId,
          venta_item_id: itemId,
          grupo_id: snap.grupo_id,
          opcion_id: snap.opcion_id,
          grupo_codigo: snap.grupo_codigo,
          grupo_etiqueta: snap.grupo_etiqueta,
          opcion_etiqueta: snap.opcion_etiqueta,
          insumo_producto_id: snap.insumo_producto_id,
          insumo_sku: snap.insumo_sku,
          insumo_nombre: snap.insumo_nombre,
          cantidad: snap.cantidad,
          unidad_medida: snap.unidad_medida,
          merma_pct: snap.merma_pct,
          costo_unitario_snapshot: snap.costo_unitario_snapshot,
        });
      }
    });
    if (variantesRows.length > 0) {
      const insVar = await sb.from("venta_item_variantes").insert(variantesRows);
      if (insVar.error) {
        throw new Error(`No se pudieron registrar las variantes elegidas: ${insVar.error.message}`);
      }
    }

    // 7) Descuento de stock + movimientos solo para productos con controla_stock=true SIN receta.
    for (const line of items) {
      const p = stockMap.get(line.producto_id)!;
      // Fase 2.2: cualquier receta activa (base o por presentación) → stock vía insumos.
      if (recetasByProducto.has(line.producto_id)) continue;
      // produccion_previa: descuenta su propio stock del terminado aunque controla_stock=false.
      if (!p.controlaStock && p.modo !== "produccion_previa") continue;
      // El stock nunca baja de 0: si se vendió sin stock, queda en 0 (la cantidad real
      // vendida queda registrada en el movimiento SALIDA, así no se pierde trazabilidad).
      const nuevoStock = Math.max(0, p.stock - line.cantidad);
      const upd = await sb
        .from("productos")
        .update({ stock_actual: nuevoStock })
        .eq("id", line.producto_id)
        .eq("empresa_id", params.empresaId);
      if (upd.error) throw new Error(upd.error.message);
      p.stock = nuevoStock;

      const mov = await sb.from("movimientos_inventario").insert({
        empresa_id: params.empresaId,
        producto_id: line.producto_id,
        producto_nombre: line.producto_nombre,
        producto_sku: line.sku,
        tipo: "SALIDA",
        cantidad: line.cantidad,
        costo_unitario: p.costo,
        origen: "venta",
        referencia: numeroControl,
        fecha: fechaIso,
        venta_id: ventaId,
        created_by: params.createdBy ?? null,
        usuario_nombre: params.usuarioNombre ?? null,
      });
      if (mov.error) throw new Error(mov.error.message);
    }

    // 7b) Descontar materia prima (insumos) por explosión de receta + movimiento SALIDA por insumo.
    for (const [insId, need] of insumoNeed) {
      const m = insumoMeta.get(insId)!;
      // Igual que productos: el stock de insumos nunca baja de 0 (la salida real
      // queda registrada en el movimiento SALIDA del insumo).
      const nuevoStock = Math.max(0, m.stock - need);
      const upd = await sb
        .from("productos")
        .update({ stock_actual: nuevoStock })
        .eq("id", insId)
        .eq("empresa_id", params.empresaId);
      if (upd.error) throw new Error(upd.error.message);
      m.stock = nuevoStock;

      const mov = await sb.from("movimientos_inventario").insert({
        empresa_id: params.empresaId,
        producto_id: insId,
        producto_nombre: m.nombre,
        producto_sku: m.sku,
        tipo: "SALIDA",
        cantidad: need,
        costo_unitario: m.costo,
        // origen restringido por CHECK a compra|venta|ajuste_manual|inventario_inicial.
        // El consumo de insumo lo causa una venta → 'venta' (se distingue por venta_id + producto insumo).
        origen: "venta",
        referencia: numeroControl,
        fecha: fechaIso,
        venta_id: ventaId,
        created_by: params.createdBy ?? null,
        usuario_nombre: params.usuarioNombre ?? null,
      });
      if (mov.error) throw new Error(mov.error.message);
    }

    // 8) Pedido cocina (tarjeta en proyectos)
    if (params.pedidoCocina) {
      const tipoQ = await sb
        .from("proyecto_tipos")
        .select("id")
        .eq("empresa_id", params.empresaId)
        .eq("codigo", "pedido")
        .eq("activo", true)
        .limit(1)
        .maybeSingle();
      if (tipoQ.error) throw new Error(tipoQ.error.message);
      if (!tipoQ.data) throw new Error("Tipo de proyecto 'pedido' no configurado para esta empresa.");
      const tipoId = (tipoQ.data as { id: string }).id;

      const estadoQ = await sb
        .from("proyecto_estados")
        .select("id")
        .eq("empresa_id", params.empresaId)
        .eq("codigo", "nuevo")
        .eq("activo", true)
        .limit(1)
        .maybeSingle();
      if (estadoQ.error) throw new Error(estadoQ.error.message);
      if (!estadoQ.data) throw new Error("Estado 'nuevo' no configurado para esta empresa.");
      const estadoId = (estadoQ.data as { id: string }).id;

      const itemsSnapshot = items.map((it) => ({
        producto_id: it.producto_id,
        producto_nombre: it.producto_nombre,
        sku: it.sku,
        cantidad: it.cantidad,
        precio_venta: it.precio_venta,
        total_linea: it.total_linea,
        nota: it.nota ?? null,
      }));
      const briefData = {
        modalidad: params.pedidoCocina.modalidad,
        mesa: params.pedidoCocina.mesa,
        cliente_nombre: params.pedidoCocina.cliente_nombre,
        cliente_telefono: params.pedidoCocina.cliente_telefono,
        direccion_entrega: params.pedidoCocina.direccion_entrega,
        observacion: params.pedidoCocina.observacion,
        items: itemsSnapshot,
        venta_id: ventaId,
        numero_control: numeroControl,
        fecha_iso: fechaIso,
      };
      const metadata = {
        source: "venta",
        venta_id: ventaId,
        numero_control: numeroControl,
        modalidad: params.pedidoCocina.modalidad,
      };
      const tituloModalidad =
        params.pedidoCocina.modalidad === "local" ? "Local"
        : params.pedidoCocina.modalidad === "delivery" ? "Delivery"
        : "Retiro";
      const detalle =
        params.pedidoCocina.modalidad === "local" && params.pedidoCocina.mesa
          ? ` · Mesa ${params.pedidoCocina.mesa}`
          : params.pedidoCocina.modalidad === "delivery" && params.pedidoCocina.cliente_nombre
          ? ` · ${params.pedidoCocina.cliente_nombre}`
          : "";
      const titulo = `Venta ${numeroControl} · ${tituloModalidad}${detalle}`.slice(0, 200);

      const insProy = await sb.from("proyectos").insert({
        empresa_id: params.empresaId,
        cliente_id: params.clienteId,
        tipo_id: tipoId,
        estado_id: estadoId,
        titulo,
        prioridad: "normal",
        monto_vendido: params.totalDeclarado,
        fecha_ingreso: fechaIso,
        brief_data: briefData,
        metadata,
      });
      if (insProy.error) throw new Error(insProy.error.message);
    }

    // 9) Cuenta por cobrar (solo CRÉDITO con cliente). El saldo inicial = total de la venta;
    //    estado 'pendiente'. NO afecta stock ni movimientos: es cobranza. Un índice único
    //    sobre venta_id impide CxC duplicada si la venta se reintentara.
    let cuentaPorCobrarId: string | null = null;
    if (params.tipoVenta === "CREDITO" && params.clienteId) {
      const fechaEmision = fechaIso.slice(0, 10);
      let fechaVencimiento: string | null = null;
      if (params.fechaVencimiento) {
        fechaVencimiento = params.fechaVencimiento;
      } else if (params.plazoDias && params.plazoDias > 0) {
        const d = new Date(fechaIso);
        d.setDate(d.getDate() + params.plazoDias);
        fechaVencimiento = d.toISOString().slice(0, 10);
      }
      const insCxc = await sb
        .from("cuentas_por_cobrar")
        .insert({
          empresa_id: params.empresaId,
          cliente_id: params.clienteId,
          venta_id: ventaId,
          numero_venta: numeroControl,
          fecha_emision: fechaEmision,
          fecha_vencimiento: fechaVencimiento,
          moneda: params.moneda === "USD" ? "USD" : "PYG",
          total: calc.total,
          saldo: calc.total,
          estado: "pendiente",
        })
        .select("id")
        .single();
      if (insCxc.error) throw new Error(insCxc.error.message);
      cuentaPorCobrarId = String((insCxc.data as { id: string }).id);
    }

    return { ventaId, numeroControl, fechaIso, notaRemisionNumero, cuentaPorCobrarId };
  } catch (err) {
    await rollback();
    throw err;
  }
}
