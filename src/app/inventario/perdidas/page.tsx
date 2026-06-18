"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, PackageX, Coins, ClipboardList } from "lucide-react";
import { getMovimientos, getProductos } from "@/lib/inventario/storage";
import type { MovimientoInventario } from "@/lib/inventario/types";

/** Normaliza texto para búsqueda inteligente: minúsculas y sin acentos. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function formatGs(valor: number) {
  return `Gs. ${Math.round(valor).toLocaleString("es-PY")}`;
}

function formatFecha(iso: string) {
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yyyy}, ${hh}:${min}`;
  } catch {
    return iso;
  }
}

/** Primer día del mes actual en formato YYYY-MM-DD (zona local). */
function primerDiaMes(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Hoy en formato YYYY-MM-DD (zona local). */
function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Extrae el motivo legible de la referencia del movimiento ("Pérdida: X" → "X"). */
function motivoDeReferencia(ref?: string): string {
  if (!ref) return "—";
  const m = ref.replace(/^P[ée]rdida\s*\/?\s*merma$/i, "").replace(/^P[ée]rdida:\s*/i, "").trim();
  return m || "—";
}

const inputFilterClass =
  "border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400 transition-colors bg-white";

export default function PerdidasPage() {
  const [movs, setMovs] = useState<MovimientoInventario[]>([]);
  const [unidadPorProducto, setUnidadPorProducto] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);

  // Filtros — por defecto el mes actual vigente.
  const [busqueda, setBusqueda] = useState("");
  const [filtroUnidad, setFiltroUnidad] = useState("");
  const [fechaDesde, setFechaDesde] = useState(primerDiaMes());
  const [fechaHasta, setFechaHasta] = useState(hoyISO());

  useEffect(() => {
    let cancel = false;
    (async () => {
      const [movimientos, productos] = await Promise.all([getMovimientos(), getProductos()]);
      if (cancel) return;
      setMovs(movimientos.filter((m) => m.origen === "merma"));
      const mapa: Record<string, string> = {};
      productos.forEach((p) => {
        mapa[p.id] = p.unidad_medida || "UNIDAD";
      });
      setUnidadPorProducto(mapa);
      setCargando(false);
    })();
    return () => { cancel = true; };
  }, []);

  // Unidades de medida presentes en las pérdidas (para el filtro).
  const unidadesDisponibles = useMemo(() => {
    const set = new Set<string>();
    movs.forEach((m) => set.add(unidadPorProducto[m.producto_id] || "UNIDAD"));
    return Array.from(set).sort();
  }, [movs, unidadPorProducto]);

  const filtrados = useMemo(() => {
    const terminos = norm(busqueda).split(/\s+/).filter(Boolean);
    return movs.filter((m) => {
      const unidad = unidadPorProducto[m.producto_id] || "UNIDAD";
      // Búsqueda inteligente: todos los términos deben aparecer en nombre+sku+motivo.
      const heno = norm(`${m.producto_nombre} ${m.producto_sku} ${motivoDeReferencia(m.referencia)}`);
      const coincideBusqueda = terminos.every((t) => heno.includes(t));
      const coincideUnidad = filtroUnidad === "" || unidad === filtroUnidad;
      const fechaMov = m.fecha.slice(0, 10);
      const coincideDesde = fechaDesde === "" || fechaMov >= fechaDesde;
      const coincideHasta = fechaHasta === "" || fechaMov <= fechaHasta;
      return coincideBusqueda && coincideUnidad && coincideDesde && coincideHasta;
    });
  }, [movs, unidadPorProducto, busqueda, filtroUnidad, fechaDesde, fechaHasta]);

  // Totales del rango filtrado.
  const totalUnidades = filtrados.reduce((s, m) => s + Math.abs(m.cantidad), 0);
  const totalValor = filtrados.reduce((s, m) => s + Math.abs(m.cantidad) * m.costo_unitario, 0);
  const productosDistintos = new Set(filtrados.map((m) => m.producto_id)).size;

  const esMesActual = fechaDesde === primerDiaMes() && fechaHasta === hoyISO();
  const hayFiltrosExtra = busqueda !== "" || filtroUnidad !== "" || !esMesActual;

  function resetMesActual() {
    setBusqueda("");
    setFiltroUnidad("");
    setFechaDesde(primerDiaMes());
    setFechaHasta(hoyISO());
  }

  const nombreMes = new Date().toLocaleDateString("es-PY", { month: "long", year: "numeric" });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-800">Pérdidas / mermas</h1>
        <p className="text-gray-600">
          Productos y cantidades dados por perdidos. Por defecto se muestra el mes actual ({nombreMes}).
        </p>
      </div>

      {/* Tarjetas resumen */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
          <PackageX className="h-8 w-8 shrink-0 text-amber-600" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Unidades perdidas</p>
            <p className="text-2xl font-bold tabular-nums text-amber-900">{totalUnidades}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
          <Coins className="h-8 w-8 shrink-0 text-amber-600" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Valor al costo</p>
            <p className="text-2xl font-bold tabular-nums text-amber-900">{formatGs(totalValor)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
          <ClipboardList className="h-8 w-8 shrink-0 text-amber-600" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Registros · productos</p>
            <p className="text-2xl font-bold tabular-nums text-amber-900">
              {filtrados.length} · {productosDistintos}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-6">
        {/* Header */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold">Detalle de pérdidas</h2>
            <span className="text-sm text-gray-400">
              {filtrados.length} {filtrados.length === 1 ? "registro" : "registros"}
            </span>
          </div>
          <p className="text-xs text-gray-400">
            Las pérdidas se registran desde el botón <span className="font-medium text-gray-500">Registrar pérdida</span> en cada producto.
          </p>
        </div>

        {/* Filtros */}
        <div className="mb-5 flex flex-wrap gap-3 border-b border-gray-100 pb-5">
          <input
            type="text"
            placeholder="Buscar por producto, SKU o motivo…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className={`${inputFilterClass} min-w-64`}
          />
          <select value={filtroUnidad} onChange={(e) => setFiltroUnidad(e.target.value)} className={inputFilterClass}>
            <option value="">Todas las unidades</option>
            {unidadesDisponibles.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <label className="whitespace-nowrap text-xs text-gray-400">Desde</label>
            <input
              type="date"
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
              max={fechaHasta || undefined}
              className={inputFilterClass}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="whitespace-nowrap text-xs text-gray-400">Hasta</label>
            <input
              type="date"
              value={fechaHasta}
              onChange={(e) => setFechaHasta(e.target.value)}
              min={fechaDesde || undefined}
              className={inputFilterClass}
            />
          </div>
          {hayFiltrosExtra && (
            <button
              onClick={resetMesActual}
              className="rounded-lg px-2 text-sm text-gray-400 transition-colors hover:text-gray-600"
            >
              Volver al mes actual
            </button>
          )}
        </div>

        {/* Tabla */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] sm:min-w-0 text-left text-sm">
            <thead>
              <tr className="border-b text-gray-500">
                <th className="py-3 pr-4 font-medium">Producto</th>
                <th className="py-3 pr-4 font-medium hidden md:table-cell">SKU</th>
                <th className="py-3 pr-4 font-medium text-right">Cantidad</th>
                <th className="py-3 pr-4 font-medium hidden sm:table-cell">Unidad</th>
                <th className="py-3 pr-4 font-medium text-right hidden lg:table-cell">Valor</th>
                <th className="py-3 pr-4 font-medium hidden md:table-cell">Motivo</th>
                <th className="py-3 pr-4 font-medium hidden lg:table-cell">Usuario</th>
                <th className="py-3 font-medium">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-400 animate-pulse">Cargando…</td>
                </tr>
              ) : filtrados.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-400">
                    {movs.length === 0
                      ? "Todavía no hay pérdidas registradas."
                      : "Ninguna pérdida coincide con los filtros."}
                  </td>
                </tr>
              ) : (
                filtrados.map((m) => {
                  const unidad = unidadPorProducto[m.producto_id] || "UNIDAD";
                  const valor = Math.abs(m.cantidad) * m.costo_unitario;
                  return (
                    <tr key={m.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="py-4 pr-4 font-medium text-gray-800">{m.producto_nombre}</td>
                      <td className="py-4 pr-4 font-mono text-gray-500 hidden md:table-cell">{m.producto_sku}</td>
                      <td className="py-4 pr-4 text-right font-semibold tabular-nums text-amber-700">
                        −{Math.abs(m.cantidad)}
                      </td>
                      <td className="py-4 pr-4 text-gray-600 hidden sm:table-cell">{unidad}</td>
                      <td className="py-4 pr-4 text-right tabular-nums text-gray-700 hidden lg:table-cell">
                        {formatGs(valor)}
                      </td>
                      <td className="py-4 pr-4 text-gray-600 hidden md:table-cell">{motivoDeReferencia(m.referencia)}</td>
                      <td className="py-4 pr-4 text-xs text-gray-600 hidden lg:table-cell">
                        {m.usuario_nombre ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-4 text-xs tabular-nums text-gray-500">{formatFecha(m.fecha)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <span>
          ¿Necesitás dar de baja stock perdido? Entrá a <Link href="/inventario" className="underline">Productos</Link>,
          abrí un producto y usá <strong>Registrar pérdida / merma</strong>.
        </span>
      </div>
    </div>
  );
}
