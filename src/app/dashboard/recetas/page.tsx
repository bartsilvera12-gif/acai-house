"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { ChefHat, Plus, Loader2 } from "lucide-react";
import { formatUnidad } from "@/lib/unidades/format";
import DragScroll from "@/components/ui/DragScroll";

type RecetaRow = {
  id: string;
  producto_id: string;
  presentacion_id: string | null;
  nombre: string | null;
  producto_nombre: string | null;
  presentacion_nombre: string | null;
  rendimiento_cantidad: number;
  rendimiento_unidad: string | null;
  activa: boolean;
  updated_at: string;
};
type CoberturaRow = {
  producto_id: string;
  producto_nombre: string;
  sku: string;
  presentaciones: Array<{ presentacion_id: string | null; presentacion_nombre: string | null; tiene_receta: boolean }>;
};

export default function RecetasListPage() {
  const [recetas, setRecetas] = useState<RecetaRow[]>([]);
  const [cobertura, setCobertura] = useState<CoberturaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [r1, r2] = await Promise.all([
          fetchWithSupabaseSession("/api/recetas", { cache: "no-store" }),
          fetchWithSupabaseSession("/api/recetas/productos?filtro=cobertura", { cache: "no-store" }),
        ]);
        const b1 = await r1.json();
        const b2 = await r2.json();
        if (cancelled) return;
        if (!r1.ok || b1?.success === false) {
          setError(b1?.error ?? "Error al cargar recetas");
          setRecetas([]);
        } else {
          setRecetas(b1.data?.recetas ?? []);
        }
        if (r2.ok && b2?.success) setCobertura(b2.data?.cobertura ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalCeldas = cobertura.reduce((a, c) => a + c.presentaciones.length, 0);
  const conReceta = cobertura.reduce((a, c) => a + c.presentaciones.filter((p) => p.tiene_receta).length, 0);
  const pendientes = totalCeldas - conReceta;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]"
              style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.18)" }}
            />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">
              Zentra · Cocina
            </p>
          </div>
          <div className="mt-1 flex items-center gap-3">
            <ChefHat className="h-5 w-5 text-[#4FAEB2]" />
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">Recetas</h1>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">Recetario de productos preparados por el local.</p>
        </div>
        <Link
          href="/dashboard/recetas/nueva"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91] active:scale-95"
        >
          <Plus className="h-4 w-4" />
          Nueva receta
        </Link>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && cobertura.length > 0 && (
        <div className="mb-5 rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Cobertura de recetas por presentación</h2>
            <div className="text-xs text-slate-500">
              <span className="font-semibold text-emerald-700">{conReceta}</span>
              <span className="mx-1">/</span>
              <span>{totalCeldas}</span>
              <span className="ml-2">({pendientes} pendientes)</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left uppercase text-[10px] text-slate-500">
                <tr>
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2">Presentación</th>
                  <th className="px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cobertura.flatMap((c) =>
                  c.presentaciones.map((p, idx) => (
                    <tr key={`${c.producto_id}:${p.presentacion_id ?? "null"}`}>
                      <td className="px-3 py-1.5 text-slate-700">{idx === 0 ? c.producto_nombre : ""}</td>
                      <td className="px-3 py-1.5 text-slate-700">{p.presentacion_nombre ?? "— base —"}</td>
                      <td className="px-3 py-1.5">
                        {p.tiene_receta ? (
                          <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">Con receta</span>
                        ) : (
                          <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">Pendiente</span>
                        )}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && !error && recetas.length === 0 && (
        <div className="rounded-md border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          Todavía no hay recetas. Creá la primera para empezar a costear tus productos.
        </div>
      )}

      {!loading && recetas.length > 0 && (
        /* overflow-x-auto + min-w para que el link "Editar" no se corte en mobile.
           "Actualizado" se oculta en mobile (data secundaria). */
        <DragScroll className="rounded-md border border-gray-200 bg-white">
          <table className="w-full min-w-[680px] sm:min-w-0 text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2">Nombre</th>
                <th className="px-4 py-2">Rendimiento</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2 hidden md:table-cell">Actualizado</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recetas.map((r) => (
                <tr key={r.id} className="hover:bg-[#4FAEB2]/[0.04] transition-colors">
                  <td className="px-4 py-2 font-medium text-gray-900">
                    {r.nombre?.trim()
                      ? r.nombre
                      : r.producto_nombre
                        ? <span>Receta: {r.producto_nombre}</span>
                        : <span className="text-gray-400">(sin nombre)</span>}
                    {r.presentacion_nombre ? (
                      <span className="ml-2 inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-normal text-sky-700">{r.presentacion_nombre}</span>
                    ) : (
                      <span className="ml-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-normal text-slate-500">base</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-700">
                    {r.rendimiento_cantidad} {formatUnidad(r.rendimiento_unidad)}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                        r.activa ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {r.activa ? "Activa" : "Inactiva"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500 hidden md:table-cell">
                    {new Date(r.updated_at).toLocaleString("es-PY")}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/dashboard/recetas/${r.id}`}
                      className="text-amber-600 hover:text-amber-700"
                    >
                      Editar
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DragScroll>
      )}
    </div>
  );
}
