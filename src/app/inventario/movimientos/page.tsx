"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getMovimientos } from "@/lib/inventario/storage";
import type { MovimientoInventario, TipoMovimiento, OrigenMovimiento } from "@/lib/inventario/types";

const tipoBadge: Record<TipoMovimiento, string> = {
  ENTRADA: "bg-emerald-100 text-emerald-800",
  SALIDA: "bg-rose-100 text-rose-800",
  AJUSTE: "bg-amber-100 text-amber-800",
};

const tipoIcon: Record<TipoMovimiento, string> = {
  ENTRADA: "↓",
  SALIDA: "↑",
  AJUSTE: "⇄",
};

const tipoBorder: Record<TipoMovimiento, string> = {
  ENTRADA: "border-l-emerald-500",
  SALIDA: "border-l-rose-500",
  AJUSTE: "border-l-amber-500",
};

const origenLabel: Record<OrigenMovimiento, string> = {
  compra: "Compra",
  venta: "Venta",
  ajuste_manual: "Ajuste manual",
  inventario_inicial: "Inventario inicial",
  produccion: "Producción",
  merma: "Merma",
};

const origenBadge: Record<OrigenMovimiento, string> = {
  compra: "bg-blue-50 text-blue-600",
  venta: "bg-purple-50 text-purple-600",
  ajuste_manual: "bg-gray-100 text-gray-600",
  inventario_inicial: "bg-orange-50 text-orange-600",
  produccion: "bg-teal-50 text-teal-600",
  merma: "bg-amber-100 text-amber-700",
};

function formatGs(valor: number) {
  return `Gs. ${valor.toLocaleString("es-PY")}`;
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

function tiempoRelativo(iso: string) {
  try {
    const d = new Date(iso).getTime();
    const ahora = Date.now();
    const diff = Math.floor((ahora - d) / 1000);
    if (diff < 60) return "hace unos segundos";
    if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
    if (diff < 86400 * 7) return `hace ${Math.floor(diff / 86400)} d`;
    return null;
  } catch { return null; }
}

function iniciales(nombre: string) {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase() ?? "").join("");
}

const inputFilterClass =
  "border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400 transition-colors bg-white";

export default function MovimientosPage() {
  const [todos, setTodos] = useState<MovimientoInventario[]>([]);

  // Filtros
  const [busqueda, setBusqueda] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<TipoMovimiento | "">("");
  const [filtroOrigen, setFiltroOrigen] = useState<OrigenMovimiento | "">("");
  const [fechaDesde, setFechaDesde] = useState("");  // "YYYY-MM-DD"
  const [fechaHasta, setFechaHasta] = useState(""); // "YYYY-MM-DD"

  useEffect(() => {
    let cancelled = false;
    getMovimientos().then((data) => {
      if (!cancelled) setTodos(data);
    });
    return () => { cancelled = true; };
  }, []);

  const filtrados = todos.filter((m) => {
    const texto = busqueda.toLowerCase();
    const coincideTexto =
      texto === "" ||
      m.producto_nombre.toLowerCase().includes(texto) ||
      m.producto_sku.toLowerCase().includes(texto);
    const coincideTipo = filtroTipo === "" || m.tipo === filtroTipo;
    const coincideOrigen = filtroOrigen === "" || m.origen === filtroOrigen;

    // Compara solo la parte de fecha (YYYY-MM-DD) del ISO string del movimiento
    const fechaMov = m.fecha.slice(0, 10); // "YYYY-MM-DD"
    const coincideDesde = fechaDesde === "" || fechaMov >= fechaDesde;
    const coincideHasta = fechaHasta === "" || fechaMov <= fechaHasta;

    return coincideTexto && coincideTipo && coincideOrigen && coincideDesde && coincideHasta;
  });

  // Resumen de pérdidas/mermas del mes en curso (para seguimiento mensual).
  const ahora = new Date();
  const mesActual = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}`; // "YYYY-MM"
  const nombreMes = ahora.toLocaleDateString("es-PY", { month: "long", year: "numeric" });
  const mermasMes = todos.filter((m) => m.origen === "merma" && m.fecha.slice(0, 7) === mesActual);
  const mermasMesUnidades = mermasMes.reduce((s, m) => s + Math.abs(m.cantidad), 0);
  const mermasMesValor = mermasMes.reduce((s, m) => s + Math.abs(m.cantidad) * m.costo_unitario, 0);

  return (
    <div className="space-y-8">

      <div>
        <h1 className="text-3xl font-bold text-gray-800">Movimientos de inventario</h1>
        <p className="text-gray-600">Registro de entradas, salidas y ajustes de stock</p>
      </div>

      {/* Resumen de pérdidas / mermas del mes en curso */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            Pérdidas / mermas — {nombreMes}
          </p>
          <p className="mt-1 text-sm text-amber-900">
            <span className="font-bold tabular-nums">{mermasMesUnidades}</span> unidades dadas por perdidas
            <span className="mx-2 text-amber-400">·</span>
            <span className="font-bold tabular-nums">Gs. {Math.round(mermasMesValor).toLocaleString("es-PY")}</span> al costo
            <span className="mx-2 text-amber-400">·</span>
            <span className="tabular-nums">{mermasMes.length}</span> registros
          </p>
        </div>
        {filtroOrigen !== "merma" ? (
          <button
            onClick={() => setFiltroOrigen("merma")}
            className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100"
          >
            Ver solo mermas
          </button>
        ) : (
          <button
            onClick={() => setFiltroOrigen("")}
            className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100"
          >
            Quitar filtro
          </button>
        )}
      </div>

      {/* KPI mini-cards: panorama rápido del rango filtrado */}
      {(() => {
        const stats = {
          total: filtrados.length,
          entrada: filtrados.filter(m => m.tipo === "ENTRADA").length,
          salida: filtrados.filter(m => m.tipo === "SALIDA").length,
          ajuste: filtrados.filter(m => m.tipo === "AJUSTE").length,
        };
        const cards = [
          { label: "Movimientos", value: stats.total, color: "text-slate-800", ring: "bg-slate-100 text-slate-600", icon: "≡" },
          { label: "Entradas", value: stats.entrada, color: "text-emerald-700", ring: "bg-emerald-100 text-emerald-700", icon: "↓" },
          { label: "Salidas", value: stats.salida, color: "text-rose-700", ring: "bg-rose-100 text-rose-700", icon: "↑" },
          { label: "Ajustes", value: stats.ajuste, color: "text-amber-700", ring: "bg-amber-100 text-amber-700", icon: "⇄" },
        ];
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {cards.map(c => (
              <div key={c.label} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold ${c.ring}`}>{c.icon}</div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{c.label}</p>
                  <p className={`text-2xl font-bold tabular-nums ${c.color}`}>{c.value}</p>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-slate-800">Historial</h2>
            <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full tabular-nums">
              {filtrados.length} / {todos.length}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <p className="hidden md:block text-xs text-slate-400">
              Los movimientos se generan automáticamente desde <span className="font-medium text-slate-600">Compras</span> y <span className="font-medium text-slate-600">Ventas</span>
            </p>
            <Link
              href="/inventario/movimientos/nuevo"
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 text-sm font-medium transition-colors"
            >
              <span aria-hidden>+</span> Nuevo movimiento
            </Link>
          </div>
        </div>

        {/* Filtros */}
        <div className="px-6 py-4 border-b border-slate-100 space-y-3 bg-slate-50/50">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
              <input
                type="text"
                placeholder="Buscar producto o SKU..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 transition-all bg-white"
              />
            </div>
            <select
              value={filtroOrigen}
              onChange={(e) => setFiltroOrigen(e.target.value as OrigenMovimiento | "")}
              className={inputFilterClass}
            >
              <option value="">Todos los orígenes</option>
              <option value="compra">Compra</option>
              <option value="venta">Venta</option>
              <option value="ajuste_manual">Ajuste manual</option>
              <option value="produccion">Producción</option>
              <option value="merma">Merma</option>
            </select>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={fechaDesde}
                onChange={(e) => setFechaDesde(e.target.value)}
                max={fechaHasta || undefined}
                className={inputFilterClass}
                aria-label="Desde"
              />
              <span className="text-slate-400 text-sm">→</span>
              <input
                type="date"
                value={fechaHasta}
                onChange={(e) => setFechaHasta(e.target.value)}
                min={fechaDesde || undefined}
                className={inputFilterClass}
                aria-label="Hasta"
              />
            </div>
            {(busqueda || filtroTipo || filtroOrigen || fechaDesde || fechaHasta) && (
              <button
                onClick={() => {
                  setBusqueda(""); setFiltroTipo(""); setFiltroOrigen(""); setFechaDesde(""); setFechaHasta("");
                }}
                className="text-xs text-slate-500 hover:text-rose-600 underline transition-colors"
              >
                Limpiar
              </button>
            )}
          </div>

          {/* Chips: tipo (más fácil de tocar que un select) */}
          <div className="flex flex-wrap items-center gap-1.5">
            {([
              { v: "", label: "Todos", color: "" },
              { v: "ENTRADA", label: "↓ Entradas", color: "data-[on=true]:bg-emerald-600 data-[on=true]:text-white data-[on=true]:border-emerald-600" },
              { v: "SALIDA", label: "↑ Salidas", color: "data-[on=true]:bg-rose-600 data-[on=true]:text-white data-[on=true]:border-rose-600" },
              { v: "AJUSTE", label: "⇄ Ajustes", color: "data-[on=true]:bg-amber-600 data-[on=true]:text-white data-[on=true]:border-amber-600" },
            ] as const).map(chip => {
              const on = filtroTipo === chip.v;
              return (
                <button
                  key={chip.v || "all"}
                  data-on={on}
                  onClick={() => setFiltroTipo(chip.v as TipoMovimiento | "")}
                  className={`px-3 py-1 text-xs font-medium rounded-full border transition-all border-slate-200 bg-white text-slate-600 hover:border-slate-300 data-[on=true]:bg-slate-900 data-[on=true]:text-white data-[on=true]:border-slate-900 ${chip.color}`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tabla */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] sm:min-w-0 text-left text-sm">
            <thead className="bg-white border-b border-slate-200 sticky top-0">
              <tr className="text-slate-500">
                <th className="py-3 px-6 text-[11px] font-semibold uppercase tracking-wider">Producto</th>
                <th className="py-3 px-2 text-[11px] font-semibold uppercase tracking-wider">Tipo</th>
                <th className="py-3 px-2 text-right text-[11px] font-semibold uppercase tracking-wider">Cantidad</th>
                <th className="py-3 px-2 text-right text-[11px] font-semibold uppercase tracking-wider hidden lg:table-cell">Costo unit.</th>
                <th className="py-3 px-2 text-[11px] font-semibold uppercase tracking-wider hidden md:table-cell">Origen</th>
                <th className="py-3 px-2 text-[11px] font-semibold uppercase tracking-wider hidden lg:table-cell">Usuario</th>
                <th className="py-3 px-6 text-right text-[11px] font-semibold uppercase tracking-wider">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtrados.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <div className="text-3xl">📦</div>
                      <p className="text-sm font-medium">
                        {todos.length === 0
                          ? "Aún no hay movimientos registrados"
                          : "Ningún movimiento coincide con los filtros"}
                      </p>
                      {todos.length === 0 && (
                        <Link href="/inventario/movimientos/nuevo" className="text-xs text-sky-600 hover:text-sky-800 underline">
                          Crear el primer movimiento
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filtrados.map((m) => {
                  const signo = m.tipo === "ENTRADA" ? "+" : m.tipo === "SALIDA" ? "−" : m.cantidad >= 0 ? "+" : "";
                  const cantidadColor =
                    m.tipo === "ENTRADA" ? "text-emerald-700"
                    : m.tipo === "SALIDA" ? "text-rose-700"
                    : "text-amber-700";
                  const rel = tiempoRelativo(m.fecha);
                  const ini = m.usuario_nombre ? iniciales(m.usuario_nombre) : null;

                  return (
                    <tr key={m.id} className={`border-l-4 ${tipoBorder[m.tipo]} hover:bg-slate-50/70 transition-colors`}>
                      <td className="py-3 px-6">
                        <div className="font-semibold text-slate-900 leading-tight">{m.producto_nombre}</div>
                        <div className="text-[11px] font-mono text-slate-400 mt-0.5">{m.producto_sku}</div>
                      </td>
                      <td className="py-3 px-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${tipoBadge[m.tipo]}`}>
                          <span aria-hidden>{tipoIcon[m.tipo]}</span>
                          {m.tipo}
                        </span>
                      </td>
                      <td className={`py-3 px-2 text-right font-bold tabular-nums text-base ${cantidadColor}`}>
                        {signo}{Math.abs(m.cantidad)}
                        <span className="text-[10px] font-normal text-slate-400 ml-1">{(m as { unidad_medida?: string }).unidad_medida ?? ""}</span>
                      </td>
                      <td className="py-3 px-2 text-right text-slate-700 tabular-nums hidden lg:table-cell">
                        {formatGs(m.costo_unitario)}
                      </td>
                      <td className="py-3 px-2 hidden md:table-cell">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${origenBadge[m.origen]}`}>
                          {origenLabel[m.origen]}
                        </span>
                      </td>
                      <td className="py-3 px-2 hidden lg:table-cell">
                        {m.usuario_nombre ? (
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br from-sky-400 to-sky-600 text-white text-[10px] font-bold">
                              {ini}
                            </span>
                            <span className="text-xs text-slate-700 truncate max-w-[140px]">{m.usuario_nombre}</span>
                          </div>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="py-3 px-6 text-right">
                        <div className="text-xs font-medium text-slate-700 tabular-nums">{formatFecha(m.fecha)}</div>
                        {rel && <div className="text-[10px] text-slate-400 mt-0.5">{rel}</div>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

      </div>

    </div>
  );
}
