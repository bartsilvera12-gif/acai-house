"use client";

import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Resumen = {
  periodo_actual_etiqueta: string;
  timezone_usado: string;
  politica_activa: Record<string, unknown> | null;
  mensaje_calculo: string;
};

export default function ComisionesPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Resumen | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchWithSupabaseSession("/api/comisiones/resumen", { cache: "no-store" });
        const json = (await res.json()) as { success?: boolean; data?: Resumen; error?: string };
        if (!res.ok || json.success !== true || !json.data) {
          throw new Error(json.error ?? `Error ${res.status}`);
        }
        if (!cancelled) setData(json.data);
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

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-sm text-slate-500">
        Cargando módulo de comisiones…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      </div>
    );
  }

  const pol = data?.politica_activa;
  const nombrePol =
    pol && typeof pol.nombre === "string" ? pol.nombre : "Sin política activa configurada";

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Comisiones</h1>
        <p className="mt-1 text-sm text-slate-600">
          Vista inicial del módulo. La liquidación automática se habilitará por etapas.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Período actual</p>
          <p className="mt-2 text-lg font-semibold capitalize text-slate-900">
            {data?.periodo_actual_etiqueta ?? "—"}
          </p>
          <p className="mt-1 text-xs text-slate-500">{data?.timezone_usado}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Política activa</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">{nombrePol}</p>
          {pol && pol.activo === false && (
            <p className="mt-1 text-xs text-amber-700">La política existe pero está marcada como inactiva.</p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-sky-100 bg-sky-50 px-5 py-4 text-sm text-sky-950">
        <p className="font-medium">Próximo paso</p>
        <p className="mt-1 text-sky-900/90">{data?.mensaje_calculo}</p>
      </div>
    </div>
  );
}
