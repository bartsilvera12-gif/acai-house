"use client";

import { useEffect, useRef, useState } from "react";

export interface PresentacionPicker {
  id: string;
  nombre: string;
  precio: number;
  orden?: number;
}

export interface AdicionalPicker {
  id: string;
  nombre: string;
  precio: number;
}

export interface ProductoPickerItem {
  id: string;
  nombre: string;
  sku: string;
  codigo_barras: string | null;
  codigo_barras_interno: boolean;
  precio_venta: number;
  precio_mayorista: number;
  precio_distribuidor?: number | null;
  costo_promedio: number;
  stock_actual: number;
  stock_minimo: number;
  unidad_medida: string;
  metodo_valuacion: string;
  imagen_url: string | null;
  imagen_path: string | null;
  categoria_nombre: string | null;
  proveedor_nombre: string | null;
  ubicacion_nombre: string | null;
  ubicacion_tipo: string | null;
  /** Si false → producto preparado (Menú): no valida stock ni muestra "Sin stock". */
  controla_stock?: boolean;
  /** Modo de receta: 'produccion_previa' (Menú stockeado) muestra stock real. */
  modo_receta?: string;
  /** Presentaciones disponibles (tamaños) con precio propio. Vacío = no aplica. */
  presentaciones?: PresentacionPicker[];
  /**
   * Ids de adicionales permitidos para este producto.
   * Si viene vacío/undefined → el producto acepta TODOS los adicionales activos.
   * Si tiene items → sólo esos se muestran en caja al vender este producto.
   */
  adicionales_permitidos_ids?: string[];
}

/** Un Menú con produccion_previa maneja stock real del terminado (como reventa para mostrar). */
function manejaStock(p: { controla_stock?: boolean; modo_receta?: string }): boolean {
  if (p.controla_stock !== false) return true;
  return p.modo_receta === "produccion_previa";
}

/**
 * Resultado emitido al hacer clic en "Agregar a la venta": el caller
 * recibe el producto, la cantidad, el precio (en la moneda de la venta)
 * y el tipo de IVA. El precio se interpreta en la moneda activa de la
 * venta, y el caller hace la conversion a PYG si corresponde.
 */
export interface AgregarVentaPayload {
  producto: ProductoPickerItem;
  cantidad: number;
  /** Precio unitario del producto base (NO incluye los adicionales). */
  precio_input: number;
  iva: "EXENTA" | "5%" | "10%";
  /** Nivel de precio elegido en el panel de detalle. */
  tipo_precio: "minorista" | "mayorista" | "distribuidor";
  /** Presentación/tamaño elegido (si el producto las tiene). */
  presentacion?: PresentacionPicker | null;
  /** Adicionales seleccionados (ya con su precio unitario). */
  adicionales?: AdicionalPicker[];
}

/**
 * Precio unitario (en PYG) según el tipo elegido, con fallbacks:
 *  minorista → precio_venta;
 *  mayorista    → precio_mayorista (>0) o fallback a precio_venta;
 *  distribuidor → precio_distribuidor (>0) o fallback a precio_venta.
 */
function precioPorTipoPicker(
  p: ProductoPickerItem,
  tipo: "minorista" | "mayorista" | "distribuidor"
): number {
  if (tipo === "mayorista") return p.precio_mayorista != null && p.precio_mayorista > 0 ? p.precio_mayorista : p.precio_venta;
  if (tipo === "distribuidor") return p.precio_distribuidor != null && p.precio_distribuidor > 0 ? p.precio_distribuidor : p.precio_venta;
  return p.precio_venta;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Callback que agrega el producto a la venta. Si retorna `false`, el modal
   *  conserva la seleccion (ej. error de stock); si retorna `true`, limpia
   *  la cantidad para seguir cargando. */
  onAgregar: (p: AgregarVentaPayload) => boolean | void;
  excludeIds?: string[];
  /** Moneda actual de la venta. */
  moneda?: "GS" | "USD";
  /** Tipo de cambio cuando moneda=USD (PYG por USD). 0 si no se cargo. */
  tipoCambio?: number;
  /** IVA default que viene de la venta. */
  ivaDefault?: "EXENTA" | "5%" | "10%";
}

function formatGs(v: number): string {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}

export default function ProductPickerModal({
  open, onClose, onAgregar, excludeIds = [], moneda = "GS", tipoCambio = 1, ivaDefault = "10%",
}: Props) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ProductoPickerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Panel detalle
  const [sel, setSel] = useState<ProductoPickerItem | null>(null);
  const [cantidad, setCantidad] = useState("1");
  const [precio, setPrecio] = useState("");
  const [iva, setIva] = useState<"EXENTA" | "5%" | "10%">(ivaDefault);
  const [tipoPrecio, setTipoPrecio] = useState<"minorista" | "mayorista" | "distribuidor">("minorista");
  const [feedback, setFeedback] = useState<string | null>(null);
  // Presentación elegida (si el producto tiene varias) y adicionales marcados.
  const [presentacionId, setPresentacionId] = useState<string | null>(null);
  const [adicionalesCatalog, setAdicionalesCatalog] = useState<AdicionalPicker[]>([]);
  const [adicionalesSeleccionados, setAdicionalesSeleccionados] = useState<Set<string>>(new Set());

  /** Precio en la moneda activa de la venta (string para el input). */
  function precioEnMonedaStr(precioGs: number): string {
    if (moneda === "USD" && tipoCambio > 0) return String(Math.round((precioGs / tipoCambio) * 100) / 100);
    return String(Math.round(precioGs));
  }

  /** Cambia el tipo de precio del producto seleccionado y ajusta el precio unitario. */
  function handleTipoPrecio(tipo: "minorista" | "mayorista" | "distribuidor") {
    setTipoPrecio(tipo);
    if (sel) setPrecio(precioEnMonedaStr(precioPorTipoPicker(sel, tipo)));
    setFeedback(null);
  }

  useEffect(() => { if (open) { setQ(""); setError(null); setSel(null); setTimeout(() => inputRef.current?.focus(), 50); } }, [open]);

  // Cargar catálogo de adicionales una vez al abrir el modal.
  useEffect(() => {
    if (!open) return;
    let cancel = false;
    fetch("/api/adicionales", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancel || !j?.success) return;
        const list = (j.data?.adicionales ?? []) as Array<{
          id: string; nombre: string; precio: number | string;
        }>;
        setAdicionalesCatalog(list.map((a) => ({ id: a.id, nombre: a.nombre, precio: Number(a.precio) })));
      })
      .catch(() => { /* no bloquea la venta */ });
    return () => { cancel = true; };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Buscar (debounce 200ms)
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true); setError(null);
      try {
        const url = new URL("/api/productos/search", window.location.origin);
        if (q.trim().length >= 2) url.searchParams.set("q", q.trim());
        url.searchParams.set("limit", "50");
        const res = await fetch(url.toString(), { credentials: "include" });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          setError(json?.error ?? "Error al buscar productos");
          setItems([]);
        } else {
          setItems((json.data?.items ?? []) as ProductoPickerItem[]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error de red");
        setItems([]);
      } finally { setLoading(false); }
    }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q, open]);

  function selectProducto(p: ProductoPickerItem) {
    setSel(p);
    setCantidad("1");
    setAdicionalesSeleccionados(new Set());
    // Si el producto tiene presentaciones, usar la primera como default y su precio.
    const presentaciones = (p.presentaciones ?? []).slice().sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    if (presentaciones.length > 0) {
      const first = presentaciones[0];
      setPresentacionId(first.id);
      setTipoPrecio("minorista");
      setPrecio(precioEnMonedaStr(first.precio));
    } else {
      setPresentacionId(null);
      setTipoPrecio("minorista");
      setPrecio(precioEnMonedaStr(precioPorTipoPicker(p, "minorista")));
    }
    setIva(ivaDefault);
    setFeedback(null);
  }

  /** Cambia la presentación seleccionada y setea el precio correspondiente. */
  function handlePresentacion(presId: string) {
    if (!sel) return;
    const pres = (sel.presentaciones ?? []).find((p) => p.id === presId);
    if (!pres) return;
    setPresentacionId(presId);
    setPrecio(precioEnMonedaStr(pres.precio));
  }

  function toggleAdicional(id: string) {
    setAdicionalesSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleAgregar() {
    if (!sel) return;
    const cantNum = parseInt(cantidad, 10) || 0;
    const precioNum = parseFloat(precio) || 0;
    if (cantNum <= 0) { setFeedback("Cantidad debe ser > 0"); return; }
    if (precioNum <= 0) { setFeedback("Precio debe ser > 0"); return; }
    if (moneda === "USD" && tipoCambio <= 0) { setFeedback("Falta tipo de cambio en la venta"); return; }
    const presentacion =
      presentacionId && sel.presentaciones
        ? sel.presentaciones.find((p) => p.id === presentacionId) ?? null
        : null;
    // Defensa en profundidad: aunque la UI sólo muestra los permitidos, re-filtramos
    // acá para que un estado stale nunca envíe un adicional prohibido.
    const permitidos = sel.adicionales_permitidos_ids ?? [];
    const adicionales = adicionalesCatalog.filter((a) => {
      if (!adicionalesSeleccionados.has(a.id)) return false;
      if (permitidos.length === 0) return true;
      return permitidos.includes(a.id);
    });
    // Venta sin stock (Fase 5): NO se bloquea por falta de stock; se permite agregar
    // y la confirmación se pide al registrar la venta.
    const ok = onAgregar({
      producto: sel,
      cantidad: cantNum,
      precio_input: precioNum,
      iva,
      tipo_precio: tipoPrecio,
      presentacion,
      adicionales,
    });
    if (ok !== false) {
      setFeedback("Producto agregado ✓");
      setCantidad("1");
      setAdicionalesSeleccionados(new Set());
      // foco al buscador para seguir cargando
      setTimeout(() => inputRef.current?.focus(), 0);
      setTimeout(() => setFeedback(null), 1500);
    }
  }

  if (!open) return null;
  const enCarritoSel = sel ? excludeIds.filter((id) => id === sel.id).length : 0;
  const dispSel = sel ? sel.stock_actual - enCarritoSel : 0;
  const precioBaseGs = moneda === "USD" ? (parseFloat(precio) || 0) * (tipoCambio || 0) : (parseFloat(precio) || 0);
  const adicionalesTotalUnit = adicionalesCatalog
    .filter((a) => adicionalesSeleccionados.has(a.id))
    .reduce((acc, a) => acc + a.precio, 0);
  const precioUnitarioGs = precioBaseGs + adicionalesTotalUnit;
  // IVA INCLUIDO: el precio ya contiene el IVA. Total de línea = (precio base + adicionales) × cantidad
  // y el IVA se desglosa desde adentro (no se suma encima). Debe coincidir con
  // la lógica de ventas/nueva (calcIva) para que el preview no engañe al cajero.
  const totalLinea = (parseInt(cantidad, 10) || 0) * precioUnitarioGs;
  // Compatibilidad: el bloque USD→GS equivale ahora al precio base.
  const precioGsEquiv = precioBaseGs;
  const ivaMonto = iva === "10%"
    ? totalLinea - totalLinea / 1.10
    : iva === "5%"
      ? totalLinea - totalLinea / 1.05
      : 0;
  const subtotal = totalLinea - ivaMonto;

  // Mobile: pt-3 (gana viewport vertical valioso, evita el modal "cortado")
  // y pt-12 en sm+ donde si hay espacio para el aire decorativo.
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-900/60 backdrop-blur-sm pt-3 sm:pt-12 px-2 sm:px-4" onClick={onClose}>
      {/* dvh (dynamic viewport height) en lugar de vh: en iOS Safari el vh
          incluye el espacio del URL bar/safe-area y el modal queda parcialmente
          oculto debajo del browser chrome. dvh devuelve el viewport REAL visible. */}
      <div className="w-full max-w-6xl bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[94dvh] sm:max-h-[88vh]" onClick={(e) => e.stopPropagation()}>
        {/* Header con buscador */}
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-slate-400 shrink-0">
              <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clipRule="evenodd" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nombre, SKU, código, categoría o ubicación..."
              className="flex-1 bg-transparent outline-none text-base text-slate-800 placeholder:text-slate-400"
              autoComplete="off"
            />
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700" title="Cerrar (Esc)">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Tokens en cualquier orden. Mínimo 2 letras por palabra. Esc para cerrar.
          </p>
        </div>

        {/* Body: lista + panel detalle.
            MASTER/DETAIL responsive:
              MOBILE (< lg): lista full-width cuando NO hay seleccion; cuando seleccionas
                             un producto, se oculta y aparece el panel detalle full-width
                             (con boton "Volver" para cerrar la seleccion).
              DESKTOP (>= lg): ambos lado a lado (60% / 40%).
            Antes el panel detalle era "hidden lg:flex" -> en mobile NO se veia el form
            para agregar el producto a la venta, por eso el usuario no podia cargar. */}
        <div className="flex flex-1 overflow-hidden">
          {/* LISTA */}
          <div className={`${sel ? "hidden lg:block" : "block"} w-full lg:w-3/5 lg:border-r border-slate-200 overflow-y-auto`}>
            {loading && <div className="p-6 text-center text-sm text-slate-400">Buscando...</div>}
            {!loading && error && <div className="m-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>}
            {!loading && !error && items.length === 0 && (
              <div className="p-10 text-center text-sm text-slate-400">
                {q.trim().length >= 2 ? `Sin resultados para "${q}"` : "Escribí para buscar productos"}
              </div>
            )}
            {!loading && !error && items.length > 0 && (
              <ul className="divide-y divide-slate-100">
                {items.map((p) => {
                  const enCarro = excludeIds.filter((id) => id === p.id).length;
                  const disp = p.stock_actual - enCarro;
                  // Menú preparado_al_vender: sin stock propio (badge Menú).
                  // Menú produccion_previa: maneja stock real del terminado → se muestra como reventa.
                  const manejaStk = manejaStock(p);
                  const sinStock = manejaStk && disp <= 0;
                  const isMenu = !manejaStk;
                  const isSel = sel?.id === p.id;
                  return (
                    <li
                      key={p.id}
                      onClick={() => selectProducto(p)}
                      className={`flex items-center gap-3 px-4 py-3 transition-colors cursor-pointer ${
                        isSel ? "bg-sky-50" : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="w-14 h-14 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                        {p.imagen_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.imagen_url} alt={p.nombre} className="w-full h-full object-cover" />
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-6 h-6 text-slate-300">
                            <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909.47.47a.75.75 0 1 1-1.06 1.06L6.53 8.091a.75.75 0 0 0-1.06 0L2.5 11.06ZM12 6.5a1 1 0 1 1 2 0 1 1 0 0 1-2 0Z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-800 truncate">{p.nombre}</div>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500 flex-wrap">
                          <span className="font-mono">{p.sku}</span>
                          {p.codigo_barras && <span className="font-mono">· {p.codigo_barras}</span>}
                          {p.categoria_nombre && <span>· {p.categoria_nombre}</span>}
                          {p.ubicacion_nombre && <span>· {p.ubicacion_nombre}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-semibold text-slate-800 tabular-nums">{formatGs(p.precio_venta)}</div>
                        {isMenu ? (
                          <div className="text-xs">
                            <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 font-medium px-2 py-0.5">Menú</span>
                          </div>
                        ) : (
                          <div className={`text-xs tabular-nums ${sinStock ? "text-red-500" : "text-slate-500"}`}>
                            {sinStock ? "Sin stock" : `${disp} ${p.unidad_medida}`}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* PANEL DETALLE
              Layout flex column:
                - Header sticky: boton Volver (mobile only).
                - Middle scrollable: imagen + info + form inputs.
                - Footer sticky: boton "+ Agregar a la venta" SIEMPRE visible.
              Antes el boton estaba al final del scroll => en mobile chico el user
              no llegaba a verlo, no podia confirmar el producto. */}
          <div className={`${sel ? "flex" : "hidden lg:flex"} w-full lg:w-2/5 flex-col bg-slate-50 min-h-0`}>
            {!sel ? (
              <div className="flex-1 flex items-center justify-center text-sm text-slate-400 p-6 text-center">
                Seleccioná un producto de la lista para ver detalle y agregar a la venta.
              </div>
            ) : (
              <>
                {/* Mobile back button — sticky en el tope del panel */}
                <div className="lg:hidden shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setSel(null)}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-2 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-200/60 hover:text-slate-900 transition-colors"
                    aria-label="Volver a la lista de productos"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                      <path fillRule="evenodd" d="M12.78 5.22a.75.75 0 0 1 0 1.06L9.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
                    </svg>
                    Volver a la lista
                  </button>
                </div>
                {/* Middle: scrollable. flex-1 + overflow-y-auto + min-h-0
                    para que el footer no se aplaste. */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3 sm:space-y-4 min-h-0">
                <div className="w-full h-28 sm:h-44 rounded-xl bg-white border border-slate-200 flex items-center justify-center overflow-hidden">
                  {sel.imagen_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={sel.imagen_url} alt={sel.nombre} className="w-full h-full object-contain" />
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-12 h-12 text-slate-300">
                      <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909.47.47a.75.75 0 1 1-1.06 1.06L6.53 8.091a.75.75 0 0 0-1.06 0L2.5 11.06ZM12 6.5a1 1 0 1 1 2 0 1 1 0 0 1-2 0Z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-slate-800">{sel.nombre}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    SKU <span className="font-mono">{sel.sku}</span>
                    {sel.codigo_barras && <> · <span className="font-mono">{sel.codigo_barras}</span></>}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <DetailItem label="Precio venta" value={formatGs(sel.precio_venta)} highlight />
                  {manejaStock(sel) ? (
                    <DetailItem label="Stock disp." value={`${dispSel} ${sel.unidad_medida}`} highlight />
                  ) : (
                    <DetailItem label="Tipo" value="Menú (preparado)" highlight />
                  )}
                </div>

                {feedback && (
                  <div className={`text-xs px-3 py-2 rounded-lg ${feedback.includes("✓") ? "bg-emerald-50 border border-emerald-200 text-emerald-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
                    {feedback}
                  </div>
                )}

                <div className="space-y-2 bg-white p-3 rounded-xl border border-slate-200">
                  {/* Presentaciones (tamaños) — solo si el producto las tiene. */}
                  {sel.presentaciones && sel.presentaciones.length > 0 && (
                    <div>
                      <label className="block text-[11px] uppercase text-slate-400 mb-1">Tamaño</label>
                      <div className="grid grid-cols-3 gap-1 border border-slate-200 rounded-lg p-1 bg-slate-50">
                        {sel.presentaciones
                          .slice()
                          .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
                          .map((pres) => (
                            <button
                              key={pres.id}
                              type="button"
                              onClick={() => handlePresentacion(pres.id)}
                              className={`py-1.5 px-1 rounded-md text-center transition-colors ${
                                presentacionId === pres.id
                                  ? "bg-[#0EA5E9] text-white"
                                  : "bg-white text-slate-700 hover:bg-slate-100"
                              }`}
                            >
                              <span className="block text-xs font-medium">{pres.nombre}</span>
                              <span
                                className={`block text-[10px] tabular-nums ${
                                  presentacionId === pres.id ? "text-white/90" : "text-slate-400"
                                }`}
                              >
                                {formatGs(pres.precio)}
                              </span>
                            </button>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Tipo de precio: oculto cuando el producto maneja presentaciones. */}
                  {(!sel.presentaciones || sel.presentaciones.length === 0) && (
                    <div>
                      <label className="block text-[11px] uppercase text-slate-400 mb-1">Tipo de precio</label>
                      <div className="flex border border-slate-200 rounded-lg overflow-hidden">
                        {(["minorista", "mayorista", "distribuidor"] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => handleTipoPrecio(t)}
                            className={`flex-1 py-1.5 px-1 text-center transition-colors ${
                              tipoPrecio === t ? "bg-[#0EA5E9] text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                            }`}
                          >
                            <span className="block text-xs font-medium">
                              {t === "minorista" ? "Minorista" : t === "mayorista" ? "Mayorista" : "Distribuidor"}
                            </span>
                            <span className={`block text-[10px] tabular-nums ${tipoPrecio === t ? "text-white/90" : "text-slate-400"}`}>
                              {formatGs(precioPorTipoPicker(sel, t))}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] uppercase text-slate-400 mb-1">Cantidad</label>
                      <input
                        type="number" min={1}
                        value={cantidad}
                        onChange={(e) => setCantidad(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] uppercase text-slate-400 mb-1">
                        Precio ({moneda === "USD" ? "USD" : "Gs."})
                      </label>
                      <input
                        type="number" min={0}
                        value={precio}
                        onChange={(e) => setPrecio(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                      />
                      {moneda === "USD" && (parseFloat(precio) || 0) > 0 && (
                        <p className="mt-1 text-[11px] text-slate-400">≈ {formatGs(precioGsEquiv)}</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] uppercase text-slate-400 mb-1">IVA</label>
                    <div className="flex border border-slate-200 rounded-lg overflow-hidden">
                      {(["EXENTA", "5%", "10%"] as const).map((opt) => (
                        <button
                          key={opt} type="button"
                          onClick={() => setIva(opt)}
                          className={`flex-1 py-1.5 text-xs font-medium ${iva === opt ? "bg-[#0EA5E9] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Adicionales: si el producto define una lista permitida, filtramos.
                      Lista vacía/undefined → permisivo (todos los adicionales). */}
                  {(() => {
                    const permitidos = sel.adicionales_permitidos_ids ?? [];
                    const visibles =
                      permitidos.length > 0
                        ? adicionalesCatalog.filter((a) => permitidos.includes(a.id))
                        : adicionalesCatalog;
                    if (visibles.length === 0) return null;
                    return (
                    <div className="pt-1">
                      <label className="block text-[11px] uppercase text-slate-400 mb-1">
                        Adicionales
                        {permitidos.length > 0 && (
                          <span className="ml-1 text-slate-400 normal-case font-normal">
                            (sólo los permitidos para este producto)
                          </span>
                        )}
                      </label>
                      <div className="grid grid-cols-2 gap-1">
                        {visibles.map((a) => {
                          const marcado = adicionalesSeleccionados.has(a.id);
                          return (
                            <button
                              key={a.id}
                              type="button"
                              onClick={() => toggleAdicional(a.id)}
                              className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border text-left transition-colors ${
                                marcado
                                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              <span className="text-xs font-medium truncate">{a.nombre}</span>
                              <span className="text-[11px] tabular-nums text-slate-500">
                                +{formatGs(a.precio)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {adicionalesTotalUnit > 0 && (
                        <p className="mt-1 text-[11px] text-slate-500">
                          Adicionales por unidad: <span className="tabular-nums">{formatGs(adicionalesTotalUnit)}</span>
                        </p>
                      )}
                    </div>
                    );
                  })()}

                  <div className="text-xs text-slate-500 space-y-0.5 pt-1">
                    <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{formatGs(subtotal)}</span></div>
                    <div className="flex justify-between"><span>IVA incluido</span><span className="tabular-nums">{ivaMonto > 0 ? formatGs(ivaMonto) : "—"}</span></div>
                    <div className="flex justify-between font-bold text-slate-800 pt-1 border-t border-slate-200"><span>Total línea</span><span className="tabular-nums">{formatGs(totalLinea)}</span></div>
                  </div>
                </div>
                </div>
                {/* Footer sticky con el boton de accion principal.
                    Siempre visible al final del panel, no requiere scroll. */}
                <div className="shrink-0 border-t border-slate-200 bg-white p-3 sm:p-4">
                  <button
                    type="button"
                    onClick={handleAgregar}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-sm font-semibold py-3 min-h-[48px] rounded-lg shadow-sm transition-colors"
                  >
                    + Agregar a la venta
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailItem({ label, value, highlight }: { label: string; value: string | null; highlight?: boolean }) {
  return (
    <div className={`rounded-lg px-2 py-1.5 border ${highlight ? "bg-white border-slate-200" : "bg-transparent border-transparent"}`}>
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-xs text-slate-700 truncate">{value ?? <span className="text-slate-300">—</span>}</div>
    </div>
  );
}
