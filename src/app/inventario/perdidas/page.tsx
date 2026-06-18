"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, PackageX, Coins, Download, Rows3, Boxes, Tag } from "lucide-react";
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

      <div className="bg-white rounded-xl shadow p-6">
        {/* Header */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold">{vista === "producto" ? "Pérdidas por producto" : "Detalle de pérdidas"}</h2>
            <span className="text-sm text-gray-400">
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
        {vista === "detalle" ? (
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
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] sm:min-w-0 text-left text-sm">
            <thead>
              <tr className="border-b text-gray-500">
                <th className="py-3 pr-4 font-medium">Producto</th>
                <th className="py-3 pr-4 font-medium hidden md:table-cell">SKU</th>
                <th className="py-3 pr-4 font-medium text-right">Cantidad perdida</th>
                <th className="py-3 pr-4 font-medium hidden sm:table-cell">Unidad</th>
                <th className="py-3 pr-4 font-medium text-right">Valor</th>
                <th className="py-3 pr-4 font-medium text-right hidden lg:table-cell">Registros</th>
                <th className="py-3 font-medium hidden lg:table-cell">Última pérdida</th>
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-400 animate-pulse">Cargando…</td>
                </tr>
              ) : agrupados.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-400">
                    {movs.length === 0 ? "Todavía no hay pérdidas registradas." : "Ninguna pérdida coincide con los filtros."}
                  </td>
                </tr>
              ) : (
                agrupados.map((g) => (
                  <tr key={g.producto_id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-4 pr-4 font-medium text-gray-800">{g.nombre}</td>
                    <td className="py-4 pr-4 font-mono text-gray-500 hidden md:table-cell">{g.sku}</td>
                    <td className="py-4 pr-4 text-right font-semibold tabular-nums text-amber-700">−{g.cantidad}</td>
                    <td className="py-4 pr-4 text-gray-600 hidden sm:table-cell">{g.unidad}</td>
                    <td className="py-4 pr-4 text-right font-semibold tabular-nums text-gray-800">{formatGs(g.valor)}</td>
                    <td className="py-4 pr-4 text-right tabular-nums text-gray-600 hidden lg:table-cell">{g.registros}</td>
                    <td className="py-4 text-xs tabular-nums text-gray-500 hidden lg:table-cell">{formatFecha(g.ultima)}</td>
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
