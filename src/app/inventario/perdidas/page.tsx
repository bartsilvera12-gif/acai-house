"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, PackageX, Coins, Download, Rows3, Boxes, Tag, Search } from "lucide-react";
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

/** Clases de color del chip de motivo según su tipo. */
function motivoChipCls(motivo: string): string {
  const m = norm(motivo);
  if (m.includes("robo") || m.includes("faltante")) return "bg-red-50 text-red-700 ring-red-100";
  if (m.includes("vencid")) return "bg-amber-50 text-amber-700 ring-amber-100";
  if (m.includes("danad") || m.includes("golpead") || m.includes("mal estado")) return "bg-orange-50 text-orange-700 ring-orange-100";
  if (m.includes("derrame")) return "bg-sky-50 text-sky-700 ring-sky-100";
  return "bg-slate-100 text-slate-600 ring-slate-200";
}

/** Primera letra (avatar) de un texto. */
function inicial(s: string): string {
  return s.trim().charAt(0).toUpperCase() || "?";
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

  // Vista: detalle (un registro por pérdida) o agrupada por producto.
  const [vista, setVista] = useState<"detalle" | "producto">("detalle");

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

  // Predicado base (búsqueda inteligente + unidad), sin fecha — reutilizable
  // para comparar el período actual con el anterior bajo los mismos filtros.
  const matchBase = useMemo(() => {
    const terminos = norm(busqueda).split(/\s+/).filter(Boolean);
    return (m: MovimientoInventario) => {
      const unidad = unidadPorProducto[m.producto_id] || "UNIDAD";
      const heno = norm(`${m.producto_nombre} ${m.producto_sku} ${motivoDeReferencia(m.referencia)}`);
      return terminos.every((t) => heno.includes(t)) && (filtroUnidad === "" || unidad === filtroUnidad);
    };
  }, [busqueda, filtroUnidad, unidadPorProducto]);

  const filtrados = useMemo(() => {
    return movs.filter((m) => {
      if (!matchBase(m)) return false;
      const f = m.fecha.slice(0, 10);
      return (fechaDesde === "" || f >= fechaDesde) && (fechaHasta === "" || f <= fechaHasta);
    });
  }, [movs, matchBase, fechaDesde, fechaHasta]);

  // Valor perdido al costo en el período filtrado (la métrica que importa).
  const totalValor = filtrados.reduce((s, m) => s + Math.abs(m.cantidad) * m.costo_unitario, 0);

  // Agrupado por producto: total perdido, valor y registros en el período filtrado.
  const agrupados = useMemo(() => {
    const map = new Map<
      string,
      { producto_id: string; nombre: string; sku: string; unidad: string; cantidad: number; valor: number; registros: number; ultima: string }
    >();
    for (const m of filtrados) {
      const unidad = unidadPorProducto[m.producto_id] || "UNIDAD";
      const cant = Math.abs(m.cantidad);
      const val = cant * m.costo_unitario;
      const prev = map.get(m.producto_id);
      if (prev) {
        prev.cantidad += cant;
        prev.valor += val;
        prev.registros += 1;
        if (m.fecha > prev.ultima) prev.ultima = m.fecha;
      } else {
        map.set(m.producto_id, {
          producto_id: m.producto_id,
          nombre: m.producto_nombre,
          sku: m.producto_sku,
          unidad,
          cantidad: cant,
          valor: val,
          registros: 1,
          ultima: m.fecha,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.valor - a.valor);
  }, [filtrados, unidadPorProducto]);

  // Producto con mayor valor perdido en el período (dónde se va la plata).
  const topProducto = agrupados[0] ?? null;

  // Principal motivo de pérdida (por qué se pierde): mayor valor acumulado.
  const topMotivo = useMemo(() => {
    const map = new Map<string, { motivo: string; valor: number; registros: number }>();
    for (const m of filtrados) {
      const motivo = motivoDeReferencia(m.referencia);
      const clave = motivo === "—" ? "Sin especificar" : motivo;
      const val = Math.abs(m.cantidad) * m.costo_unitario;
      const prev = map.get(clave);
      if (prev) {
        prev.valor += val;
        prev.registros += 1;
      } else {
        map.set(clave, { motivo: clave, valor: val, registros: 1 });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.valor - a.valor)[0] ?? null;
  }, [filtrados]);

  /** Descarga un arreglo de filas como CSV (separador ';' + BOM, compatible con Excel es). */
  function descargarCSV(filas: (string | number)[][], nombre: string) {
    const csv = filas
      .map((fila) => fila.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))
      .join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportar() {
    const sufijo = `${fechaDesde}_a_${fechaHasta}`;
    if (vista === "producto") {
      const filas: (string | number)[][] = [
        ["Producto", "SKU", "Cantidad perdida", "Unidad", "Valor (Gs)", "Registros", "Última pérdida"],
      ];
      agrupados.forEach((g) =>
        filas.push([g.nombre, g.sku, g.cantidad, g.unidad, Math.round(g.valor), g.registros, formatFecha(g.ultima)])
      );
      descargarCSV(filas, `perdidas_por_producto_${sufijo}.csv`);
    } else {
      const filas: (string | number)[][] = [
        ["Producto", "SKU", "Cantidad", "Unidad", "Valor (Gs)", "Motivo", "Usuario", "Fecha"],
      ];
      filtrados.forEach((m) => {
        const unidad = unidadPorProducto[m.producto_id] || "UNIDAD";
        filas.push([
          m.producto_nombre,
          m.producto_sku,
          Math.abs(m.cantidad),
          unidad,
          Math.round(Math.abs(m.cantidad) * m.costo_unitario),
          motivoDeReferencia(m.referencia),
          m.usuario_nombre ?? "",
          formatFecha(m.fecha),
        ]);
      });
      descargarCSV(filas, `perdidas_detalle_${sufijo}.csv`);
    }
  }

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

      {/* Tarjetas resumen — enfocadas en plata y acción */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* 1) Valor perdido (la métrica que importa) */}
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
          <Coins className="h-9 w-9 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Valor perdido (al costo)</p>
            <p className="text-2xl font-bold tabular-nums text-amber-900">{formatGs(totalValor)}</p>
          </div>
        </div>

        {/* 2) Producto que más perdés (dónde se va la plata) */}
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
          <PackageX className="h-9 w-9 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Producto que más perdés</p>
            {topProducto ? (
              <>
                <p className="truncate text-lg font-bold text-amber-900" title={topProducto.nombre}>{topProducto.nombre}</p>
                <p className="text-sm tabular-nums text-amber-700">
                  {formatGs(topProducto.valor)} · {topProducto.cantidad} {topProducto.unidad}
                </p>
              </>
            ) : (
              <p className="text-2xl font-bold text-amber-900">—</p>
            )}
          </div>
        </div>

        {/* 3) Principal motivo de pérdida (por qué se pierde) */}
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
          <Tag className="h-9 w-9 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Principal motivo</p>
            {topMotivo ? (
              <>
                <p className="truncate text-lg font-bold text-amber-900" title={topMotivo.motivo}>{topMotivo.motivo}</p>
                <p className="text-sm tabular-nums text-amber-700">
                  {formatGs(topMotivo.valor)} · {topMotivo.registros} {topMotivo.registros === 1 ? "vez" : "veces"}
                </p>
              </>
            ) : (
              <p className="text-2xl font-bold text-amber-900">—</p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-amber-500/10 sm:p-6">
        {/* Header */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold text-slate-900">{vista === "producto" ? "Pérdidas por producto" : "Detalle de pérdidas"}</h2>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              {vista === "producto"
                ? `${agrupados.length} ${agrupados.length === 1 ? "producto" : "productos"}`
                : `${filtrados.length} ${filtrados.length === 1 ? "registro" : "registros"}`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Toggle de vista */}
            <div className="inline-flex overflow-hidden rounded-lg border border-gray-200">
              <button
                type="button"
                onClick={() => setVista("detalle")}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                  vista === "detalle" ? "bg-amber-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                <Rows3 className="h-3.5 w-3.5" /> Detalle
              </button>
              <button
                type="button"
                onClick={() => setVista("producto")}
                className={`inline-flex items-center gap-1.5 border-l border-gray-200 px-3 py-2 text-xs font-medium transition-colors ${
                  vista === "producto" ? "bg-amber-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                <Boxes className="h-3.5 w-3.5" /> Por producto
              </button>
            </div>
            <button
              type="button"
              onClick={exportar}
              disabled={filtrados.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" /> Exportar CSV
            </button>
          </div>
        </div>

        {/* Filtros */}
        <div className="mb-5 flex flex-wrap gap-3 border-b border-gray-100 pb-5">
          <div className="relative min-w-64 flex-1 sm:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por producto, SKU o motivo…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20"
            />
          </div>
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
        {vista === "detalle" ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] sm:min-w-0 text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-3 pr-4 font-semibold">Producto</th>
                <th className="py-3 pr-4 text-right font-semibold">Cantidad</th>
                <th className="py-3 pr-4 text-right font-semibold hidden sm:table-cell">Valor</th>
                <th className="py-3 pr-4 font-semibold hidden md:table-cell">Motivo</th>
                <th className="py-3 pr-4 font-semibold hidden lg:table-cell">Usuario</th>
                <th className="py-3 font-semibold">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`sk-${i}`}>
                    <td className="py-3.5 pr-4" colSpan={6}>
                      <div className="h-9 w-full animate-pulse rounded-lg bg-slate-100" />
                    </td>
                  </tr>
                ))
              ) : filtrados.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center">
                    <div className="mx-auto flex max-w-xs flex-col items-center gap-2 text-slate-400">
                      <PackageX className="h-10 w-10 text-slate-300" />
                      <p className="text-sm font-medium text-slate-500">
                        {movs.length === 0 ? "Todavía no hay pérdidas registradas" : "Ninguna pérdida coincide con los filtros"}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtrados.map((m) => {
                  const unidad = unidadPorProducto[m.producto_id] || "UNIDAD";
                  const valor = Math.abs(m.cantidad) * m.costo_unitario;
                  const motivo = motivoDeReferencia(m.referencia);
                  return (
                    <tr key={m.id} className="transition-colors hover:bg-amber-50/40">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-sm font-bold uppercase text-amber-700">
                            {inicial(m.producto_nombre)}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-800">{m.producto_nombre}</p>
                            <p className="font-mono text-xs text-slate-400">{m.producto_sku}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold tabular-nums text-red-600 ring-1 ring-red-100">
                          −{Math.abs(m.cantidad)} <span className="font-normal opacity-70">{unidad}</span>
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-right font-semibold tabular-nums text-slate-800 hidden sm:table-cell">
                        {formatGs(valor)}
                      </td>
                      <td className="py-3 pr-4 hidden md:table-cell">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${motivoChipCls(motivo)}`}>
                          {motivo}
                        </span>
                      </td>
                      <td className="py-3 pr-4 hidden lg:table-cell">
                        {m.usuario_nombre ? (
                          <div className="flex items-center gap-2">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold uppercase text-slate-500">
                              {inicial(m.usuario_nombre)}
                            </div>
                            <span className="text-xs text-slate-600">{m.usuario_nombre}</span>
                          </div>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="py-3 text-xs tabular-nums text-slate-500">{formatFecha(m.fecha)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] sm:min-w-0 text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-3 pr-4 font-semibold">Producto</th>
                <th className="py-3 pr-4 text-right font-semibold">Cantidad perdida</th>
                <th className="py-3 pr-4 text-right font-semibold">Valor</th>
                <th className="py-3 pr-4 text-right font-semibold hidden lg:table-cell">Registros</th>
                <th className="py-3 font-semibold hidden lg:table-cell">Última pérdida</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`skg-${i}`}>
                    <td className="py-3.5 pr-4" colSpan={5}>
                      <div className="h-9 w-full animate-pulse rounded-lg bg-slate-100" />
                    </td>
                  </tr>
                ))
              ) : agrupados.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-16 text-center">
                    <div className="mx-auto flex max-w-xs flex-col items-center gap-2 text-slate-400">
                      <PackageX className="h-10 w-10 text-slate-300" />
                      <p className="text-sm font-medium text-slate-500">
                        {movs.length === 0 ? "Todavía no hay pérdidas registradas" : "Ninguna pérdida coincide con los filtros"}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                agrupados.map((g) => (
                  <tr key={g.producto_id} className="transition-colors hover:bg-amber-50/40">
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-sm font-bold uppercase text-amber-700">
                          {inicial(g.nombre)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-800">{g.nombre}</p>
                          <p className="font-mono text-xs text-slate-400">{g.sku}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold tabular-nums text-red-600 ring-1 ring-red-100">
                        −{g.cantidad} <span className="font-normal opacity-70">{g.unidad}</span>
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-right font-semibold tabular-nums text-slate-800">{formatGs(g.valor)}</td>
                    <td className="py-3 pr-4 text-right tabular-nums text-slate-500 hidden lg:table-cell">{g.registros}</td>
                    <td className="py-3 text-xs tabular-nums text-slate-500 hidden lg:table-cell">{formatFecha(g.ultima)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        )}
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
