"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getProductos, getUbicaciones, type UbicacionMin } from "@/lib/inventario/storage";
import type { Producto, MetodoValuacion } from "@/lib/inventario/types";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import ImportExcelButton from "@/components/ui/ImportExcelButton";
import EdgeScrollArea from "@/components/ui/EdgeScrollArea";
import StatCard from "@/components/ui/StatCard";
import { useIsAdmin } from "@/lib/auth/use-is-admin";
import { Search, Pencil, PackageOpen } from "lucide-react";

const inputFilterClass =
  "border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none";

const metodoBadge: Record<MetodoValuacion, string> = {
  CPP: "bg-blue-100 text-blue-700",
  FIFO: "bg-green-100 text-green-700",
  LIFO: "bg-purple-100 text-purple-700",
};

function formatGs(valor: number) {
  return `Gs. ${valor.toLocaleString("es-PY")}`;
}

/** Cantidad de stock con hasta 3 decimales (los insumos pueden quedar fraccionados). */
function formatStock(valor: number) {
  return valor.toLocaleString("es-PY", { maximumFractionDigits: 3 });
}

function foldText(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function calcularMargenVenta(costo: number, precio: number): number {
  if (precio === 0) return 0;
  return ((precio - costo) / precio) * 100;
}

function margenColor(margen: number): string {
  if (margen >= 40) return "text-green-600";
  if (margen >= 20) return "text-yellow-600";
  return "text-red-600";
}

export default function InventarioPage() {
  const { isAdmin } = useIsAdmin();
  const [todos, setTodos] = useState<Producto[]>([]);
  const [ubicaciones, setUbicaciones] = useState<UbicacionMin[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  // Filtros por columna
  const [filtroPorNombre,  setFiltroPorNombre]  = useState("");
  const [filtroPorSku,     setFiltroPorSku]     = useState("");
  const [filtroPorCosto,   setFiltroPorCosto]   = useState("");
  const [filtroPorPrecio,  setFiltroPorPrecio]  = useState("");
  const [filtroValuacion,  setFiltroValuacion]  = useState<MetodoValuacion | "">("");
  const [filtroUbicacion,  setFiltroUbicacion]  = useState<string>(""); // "", "__sin__" o id
  const [filtroTipo,       setFiltroTipo]       = useState<"todos" | "vendibles" | "insumos" | "mixtos">("todos");
  const [tab,              setTab]               = useState<"reventa" | "menu" | "materia">("reventa");
  const [cargandoLista,    setCargandoLista]     = useState(true);
  const [soloStockBajo,    setSoloStockBajo]    = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCargandoLista(true);
    getProductos()
      .then((data) => {
        if (!cancelled) setTodos(data);
      })
      .finally(() => {
        if (!cancelled) setCargandoLista(false);
      });
    // Ubicaciones para el filtro (catálogo estable, cacheado SWR 5min).
    getUbicaciones()
      .then((rows) => {
        if (!cancelled) setUbicaciones(rows);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [refreshKey]);

  // Map se reconstruia en cada render del componente (cualquier setState de
  // filtro): O(N) basura por keystroke. useMemo lo cachea hasta que cambia ubicaciones.
  const ubicacionById = useMemo(
    () => new Map(ubicaciones.map((u) => [u.id, u])),
    [ubicaciones],
  );

  // Lista filtrada: el filter recorre `todos` en cada keystroke de los filtros.
  // Con catalogos de 500-5000 productos esto era visible (lag al tipear).
  // useMemo solo recalcula cuando cambian las dependencias relevantes.
  const productos = useMemo(() => todos.filter((p) => {
    // Nombre — fold accents/diacritics ("atun" matchea "ATÚN")
    if (filtroPorNombre.trim() !== "" &&
        !foldText(p.nombre).includes(foldText(filtroPorNombre.trim())))
      return false;

    // SKU
    if (filtroPorSku.trim() !== "" &&
        !foldText(p.sku).includes(foldText(filtroPorSku.trim())))
      return false;

    // Costo promedio — acepta "35000" o "35.000"
    if (filtroPorCosto.trim() !== "") {
      const t = filtroPorCosto.trim();
      const coincide =
        String(p.costo_promedio).includes(t) ||
        p.costo_promedio.toLocaleString("es-PY").includes(t);
      if (!coincide) return false;
    }

    // Precio venta — acepta "75000" o "75.000"
    if (filtroPorPrecio.trim() !== "") {
      const t = filtroPorPrecio.trim();
      const coincide =
        String(p.precio_venta).includes(t) ||
        p.precio_venta.toLocaleString("es-PY").includes(t);
      if (!coincide) return false;
    }

    // Valuación
    if (filtroValuacion !== "" && p.metodo_valuacion !== filtroValuacion) return false;

    // Ubicación
    if (filtroUbicacion === "__sin__") {
      if (p.ubicacion_principal_id) return false;
    } else if (filtroUbicacion !== "") {
      if (p.ubicacion_principal_id !== filtroUbicacion) return false;
    }

    // Solo stock bajo
    if (soloStockBajo && p.stock_actual > p.stock_minimo) return false;

    // Tipo gastronómico (vendible/insumo/mixto)
    if (filtroTipo !== "todos") {
      const v = p.es_vendible !== false; // default true si null/undef
      const i = p.es_insumo === true;
      if (filtroTipo === "mixtos" && !(v && i)) return false;
      if (filtroTipo === "vendibles" && !(v && !i)) return false;
      if (filtroTipo === "insumos" && !(i && !v)) return false;
    }

    // Filtro por tab (Reventa | Menú | Materia prima)
    const esVendible    = p.es_vendible !== false;
    const esInsumo      = p.es_insumo === true;
    const controlaStock = p.controla_stock !== false; // default true
    if (tab === "reventa") {
      // vendibles que mueven stock real (gaseosas, postres comprados, etc.)
      if (!esVendible || !controlaStock || esInsumo) return false;
    } else if (tab === "menu") {
      // productos preparados (pizzas, lomitos, combos): vendibles SIN stock
      if (!esVendible || controlaStock || esInsumo) return false;
    } else {
      // materia prima / insumos
      if (!esInsumo) return false;
    }

    return true;
  }), [
    todos,
    filtroPorNombre,
    filtroPorSku,
    filtroPorCosto,
    filtroPorPrecio,
    filtroValuacion,
    filtroUbicacion,
    soloStockBajo,
    filtroTipo,
    tab,
  ]);

  // ── Paginación (50 por página) ─────────────────────────────────────────────
  // Render de 500-5000 productos en DOM era el lag más visible al filtrar.
  // Mostramos 50 por página y al cambiar filtros/tab volvemos a la página 1.
  const PAGINA_TAMANO = 50;
  const [pagina, setPagina] = useState(1);
  useEffect(() => {
    setPagina(1);
  }, [
    filtroPorNombre,
    filtroPorSku,
    filtroPorCosto,
    filtroPorPrecio,
    filtroValuacion,
    filtroUbicacion,
    soloStockBajo,
    filtroTipo,
    tab,
  ]);
  const totalPaginas = Math.max(1, Math.ceil(productos.length / PAGINA_TAMANO));
  const paginaActual = Math.min(pagina, totalPaginas);
  const desde = productos.length === 0 ? 0 : (paginaActual - 1) * PAGINA_TAMANO + 1;
  const hasta = Math.min(paginaActual * PAGINA_TAMANO, productos.length);
  const productosPagina = useMemo(
    () => productos.slice((paginaActual - 1) * PAGINA_TAMANO, paginaActual * PAGINA_TAMANO),
    [productos, paginaActual],
  );

  // Resumen del listado visible (por pestaña). Solo productos que controlan stock
  // entran en valorizado / bajo / disponibles; el resto (Menú sin control) se cuenta
  // únicamente en "Total productos".
  const resumen = useMemo(() => {
    // Tienen stock real: Reventa (controla_stock) y Materia prima (insumos, que se
    // mueven por compras/recetas). Solo el Menú "sin control" queda fuera.
    // produccion_previa (Menú fabricado y stockeado) sí maneja stock real del terminado.
    const conStock = productos.filter(
      (p) => !(p.controla_stock === false && p.es_insumo !== true && p.modo_receta !== "produccion_previa")
    );
    const stockValorizado = conStock.reduce((s, p) => s + p.stock_actual * p.costo_promedio, 0);
    const bajo = conStock.filter((p) => p.stock_actual <= p.stock_minimo).length;
    const disponibles = conStock.filter((p) => p.stock_actual > 0).length;
    return { total: productos.length, stockValorizado, bajo, disponibles, conStock: conStock.length };
  }, [productos]);

  const hayFiltrosActivos =
    filtroPorNombre || filtroPorSku || filtroPorCosto ||
    filtroPorPrecio || filtroValuacion || filtroUbicacion || soloStockBajo ||
    filtroTipo !== "todos";

  function limpiarFiltros() {
    setFiltroPorNombre("");
    setFiltroPorSku("");
    setFiltroPorCosto("");
    setFiltroPorPrecio("");
    setFiltroValuacion("");
    setFiltroUbicacion("");
    setSoloStockBajo(false);
    setFiltroTipo("todos");
  }

  // Columnas visibles según contexto (limpieza visual: no mostrar columnas vacías).
  const showPrecioYMargen = tab !== "materia";
  const showUbicacion = ubicaciones.length > 0;
  const colCount = 6 + (showPrecioYMargen ? 2 : 0) + (showUbicacion ? 1 : 0);

  return (
    <div className="space-y-8">

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]"
              style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.18)" }}
            />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">
              Zentra · Stock
            </p>
          </div>
          <h1 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Inventario</h1>
          <p className="mt-0.5 text-xs text-slate-500">Gestión de productos y control de stock</p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <ExportExcelButton url="/api/inventario/productos/export" />
          <ImportExcelButton
            entidad="Productos"
            previewUrl="/api/inventario/productos/import/preview"
            commitUrl="/api/inventario/productos/import/commit"
            templateUrl="/api/inventario/productos/import/template"
            permiteCrearFaltantes
            visible={isAdmin}
            onCompleted={() => setRefreshKey((k) => k + 1)}
          />
        </div>
      </div>

      {/* Tabs gastronómicos (filtran por tipo de producto) */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Tabs">
          {([
            { id: "reventa", label: "Reventa", subtitle: "Productos comprados y revendidos" },
            { id: "menu",    label: "Menú",    subtitle: "Productos preparados por el local" },
            { id: "materia", label: "Materia prima", subtitle: "Insumos para costeo/recetas" },
          ] as const).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap border-b-2 py-2 px-1 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "border-amber-500 text-amber-600"
                  : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
              }`}
              title={t.subtitle}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Resumen por pestaña */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard compact label="Total productos" value={String(resumen.total)} accent
          hint={tab === "reventa" ? "Reventa" : tab === "menu" ? "Menú" : "Materia prima"} />
        <StatCard compact label="Stock valorizado" value={formatGs(Math.round(resumen.stockValorizado))}
          hint="stock × costo prom." />
        <StatCard compact label="Stock bajo" value={String(resumen.bajo)}
          hint="≤ stock mínimo" />
        <StatCard compact
          label={tab === "materia" ? "Materias disponibles" : "Con stock disponible"}
          value={String(resumen.disponibles)} hint="stock > 0" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-[#4FAEB2]/15 sm:p-5 lg:p-6">

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Productos</h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
              {productos.length}
            </span>
          </div>
          <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
            <div className="relative min-w-0 flex-1 sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por nombre…"
                value={filtroPorNombre}
                onChange={(e) => setFiltroPorNombre(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 sm:w-64"
              />
            </div>
            <Link
              href="/inventario/nuevo"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3.5 py-2 text-sm font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition hover:bg-[#3F8E91] active:scale-95"
            >
              <span className="text-base leading-none">+</span>
              <span className="hidden sm:inline">Nuevo producto</span>
              <span className="sm:hidden">Nuevo</span>
            </Link>
          </div>
        </div>

        {/* Filtros por columna — fila 1 (SKU/Costo/Precio) oculta para UX simplificada */}
        <div className="hidden space-y-3 mb-5 pb-5 border-b border-gray-100">

          {/* Fila 1: filtros de texto por columna */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Nombre</label>
              <input
                type="text"
                placeholder="Buscar nombre..."
                value={filtroPorNombre}
                onChange={(e) => setFiltroPorNombre(e.target.value)}
                className={inputFilterClass}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">SKU</label>
              <input
                type="text"
                placeholder="Buscar SKU..."
                value={filtroPorSku}
                onChange={(e) => setFiltroPorSku(e.target.value)}
                className={inputFilterClass}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Costo promedio</label>
              <input
                type="text"
                placeholder="Ej: 35000"
                value={filtroPorCosto}
                onChange={(e) => setFiltroPorCosto(e.target.value)}
                className={inputFilterClass}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Precio venta</label>
              <input
                type="text"
                placeholder="Ej: 75000"
                value={filtroPorPrecio}
                onChange={(e) => setFiltroPorPrecio(e.target.value)}
                className={inputFilterClass}
              />
            </div>
          </div>

          {/* Fila 2: valuación, ubicación, stock bajo, limpiar y contador
              Ocultada para instancia En lo de Mari — la lógica de filtros sigue activa pero sin UI. */}
          <div className="hidden flex-wrap items-center gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Valuación</label>
              <select
                value={filtroValuacion}
                onChange={(e) => setFiltroValuacion(e.target.value as MetodoValuacion | "")}
                className={inputFilterClass}
              >
                <option value="">Todos los métodos</option>
                <option value="CPP">CPP</option>
                <option value="FIFO">FIFO</option>
                <option value="LIFO">LIFO</option>
              </select>
            </div>
            <div className="min-w-[14rem]">
              <label className="block text-xs text-gray-400 mb-1">Depósito / Ubicación</label>
              <select
                value={filtroUbicacion}
                onChange={(e) => setFiltroUbicacion(e.target.value)}
                className={`${inputFilterClass} w-full`}
              >
                <option value="">Todas las ubicaciones</option>
                <option value="__sin__">Sin ubicación asignada</option>
                {ubicaciones.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre} — {u.tipo}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none mt-4">
              <input
                type="checkbox"
                checked={soloStockBajo}
                onChange={(e) => setSoloStockBajo(e.target.checked)}
                className="rounded"
              />
              Solo stock bajo
            </label>
            <div className="mt-4 flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 p-0.5">
              {(["todos","vendibles","insumos","mixtos"] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setFiltroTipo(opt)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition ${
                    filtroTipo === opt
                      ? "bg-white text-amber-700 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {opt === "todos" ? "Todos" : opt[0].toUpperCase() + opt.slice(1)}
                </button>
              ))}
            </div>
            {hayFiltrosActivos && (
              <button
                onClick={limpiarFiltros}
                className="mt-4 text-sm text-gray-400 hover:text-gray-600 transition-colors px-2"
              >
                Limpiar filtros
              </button>
            )}
            <span className="ml-auto text-sm text-gray-400 self-end mb-0.5">
              {productos.length} de {todos.length} productos
            </span>
          </div>

        </div>

        <EdgeScrollArea>
          {/* min-w-[1100px] fuerza scroll horizontal real en mobile; en >=lg
              vuelve a comportarse natural. Columnas no críticas (SKU, Unidad,
              Ubicacion, Valuacion, Margen) se ocultan progresivamente. */}
          <table className="w-full min-w-[720px] lg:min-w-0 text-left text-sm">

            <thead>
              <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-3 pr-4 font-semibold">Producto</th>
                <th className="py-3 pr-4 text-right font-semibold">Costo</th>
                {showPrecioYMargen && <th className="py-3 pr-4 text-right font-semibold">Precio</th>}
                <th className="py-3 pr-4 text-center font-semibold">Stock</th>
                <th className="hidden py-3 pr-4 text-center font-semibold lg:table-cell">Mínimo</th>
                {showUbicacion && <th className="hidden py-3 pr-4 font-semibold lg:table-cell">Ubicación</th>}
                <th className="hidden py-3 pr-4 text-center font-semibold lg:table-cell">Valuación</th>
                {showPrecioYMargen && (
                  <th className="hidden py-3 pr-4 text-right font-semibold lg:table-cell">
                    <span title="(precio - costo) / precio × 100">Margen</span>
                  </th>
                )}
                <th className="w-24 py-3 pl-4 text-center font-semibold">Acción</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {cargandoLista ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`sk-${i}`}>
                    <td className="py-3.5 pr-4" colSpan={colCount}>
                      <div className="h-9 w-full animate-pulse rounded-lg bg-slate-100" />
                    </td>
                  </tr>
                ))
              ) : productos.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="py-16 text-center">
                    <div className="mx-auto flex max-w-xs flex-col items-center gap-2 text-slate-400">
                      <PackageOpen className="h-10 w-10 text-slate-300" />
                      <p className="text-sm font-medium text-slate-500">No hay productos en esta vista</p>
                      <p className="text-xs">
                        {filtroPorNombre ? "Probá con otra búsqueda." : "Cambiá de pestaña o cargá un producto nuevo."}
                      </p>
                      <Link
                        href="/inventario/nuevo"
                        className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#3F8E91]"
                      >
                        + Nuevo producto
                      </Link>
                    </div>
                  </td>
                </tr>
              ) : (
                productosPagina.map((p) => {
                  const stockBajo = p.stock_actual <= p.stock_minimo;
                  const margen = calcularMargenVenta(p.costo_promedio, p.precio_venta);
                  // "Sin control" SOLO para Menú (vendible sin stock). Los insumos
                  // (Materia prima) sí tienen stock real aunque controla_stock=false.
                  const sinControl =
                    p.controla_stock === false && p.es_insumo !== true && p.modo_receta !== "produccion_previa";
                  const v = p.es_vendible !== false;
                  const esInsumo = p.es_insumo === true;
                  return (
                    <tr key={p.id} className="group transition-colors hover:bg-[#4FAEB2]/[0.04]">
                      {/* Producto: avatar inicial + nombre + SKU */}
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#4FAEB2]/10 text-sm font-bold uppercase text-[#3F8E91]">
                            {p.nombre.trim().charAt(0) || "?"}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-medium text-slate-800">{p.nombre}</span>
                              {v && esInsumo ? (
                                <span className="inline-flex shrink-0 items-center rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700">Mixto</span>
                              ) : esInsumo ? (
                                <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Insumo</span>
                              ) : null}
                            </div>
                            <span className="font-mono text-xs text-slate-400">{p.sku}</span>
                          </div>
                        </div>
                      </td>
                      {/* Costo */}
                      <td className="py-3 pr-4 text-right tabular-nums text-slate-600">{formatGs(p.costo_promedio)}</td>
                      {/* Precio */}
                      {showPrecioYMargen && (
                        <td className="py-3 pr-4 text-right tabular-nums text-slate-700">{formatGs(p.precio_venta)}</td>
                      )}
                      {/* Stock como pill con color */}
                      <td className="py-3 pr-4 text-center">
                        {sinControl ? (
                          <span className="text-xs text-slate-400">Sin control</span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${
                              stockBajo ? "bg-red-50 text-red-600 ring-1 ring-red-100" : "bg-emerald-50 text-emerald-700"
                            }`}
                          >
                            {formatStock(p.stock_actual)}
                            <span className="font-normal opacity-70">{p.unidad_medida}</span>
                          </span>
                        )}
                      </td>
                      {/* Mínimo */}
                      <td className="hidden py-3 pr-4 text-center text-slate-500 lg:table-cell">
                        {sinControl ? "—" : <span className="tabular-nums">{formatStock(p.stock_minimo)}</span>}
                      </td>
                      {/* Ubicación (solo si hay ubicaciones cargadas) */}
                      {showUbicacion && (
                        <td className="hidden py-3 pr-4 text-xs text-slate-600 lg:table-cell">
                          {p.ubicacion_principal_id
                            ? (() => {
                                const u = ubicacionById.get(p.ubicacion_principal_id);
                                return u ? (
                                  <span>
                                    <span className="font-medium text-slate-700">{u.nombre}</span>
                                    <span className="text-slate-400"> — {u.tipo}</span>
                                  </span>
                                ) : (
                                  <span className="text-slate-300">—</span>
                                );
                              })()
                            : <span className="text-slate-300">—</span>}
                        </td>
                      )}
                      {/* Valuación */}
                      <td className="hidden py-3 pr-4 text-center lg:table-cell">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${metodoBadge[p.metodo_valuacion]}`}>
                          {p.metodo_valuacion}
                        </span>
                      </td>
                      {/* Margen */}
                      {showPrecioYMargen && (
                        <td className={`hidden py-3 pr-4 text-right font-semibold tabular-nums lg:table-cell ${margenColor(margen)}`}>
                          {margen.toFixed(1)}%
                        </td>
                      )}
                      {/* Acción */}
                      <td className="py-3 pl-4 text-center">
                        <Link
                          href={`/inventario/${p.id}/editar`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-[#4FAEB2]/50 hover:bg-[#4FAEB2]/5 hover:text-[#3F8E91]"
                        >
                          <Pencil className="h-3.5 w-3.5" /> Editar
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

          </table>
        </EdgeScrollArea>

        {/* Paginador (50 por página). Solo se muestra si hay más de una página. */}
        {productos.length > PAGINA_TAMANO && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 text-sm">
            <p className="text-slate-500">
              Mostrando <span className="font-semibold text-slate-700 tabular-nums">{desde}</span>–
              <span className="font-semibold text-slate-700 tabular-nums">{hasta}</span> de{" "}
              <span className="font-semibold text-slate-700 tabular-nums">{productos.length}</span>
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
                disabled={paginaActual <= 1}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-[#4FAEB2]/50 hover:bg-[#4FAEB2]/5 hover:text-[#3F8E91] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-slate-600"
                aria-label="Página anterior"
              >
                ‹ Anterior
              </button>
              <span className="px-3 text-xs tabular-nums text-slate-500">
                Página <span className="font-semibold text-slate-700">{paginaActual}</span> de{" "}
                <span className="font-semibold text-slate-700">{totalPaginas}</span>
              </span>
              <button
                type="button"
                onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                disabled={paginaActual >= totalPaginas}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-[#4FAEB2]/50 hover:bg-[#4FAEB2]/5 hover:text-[#3F8E91] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-slate-600"
                aria-label="Página siguiente"
              >
                Siguiente ›
              </button>
            </div>
          </div>
        )}

      </div>

    </div>
  );
}
