"use client";

/**
 * Fase 2.2 Parte 4 — Editor de grupos de variantes obligatorias en una receta.
 *
 * Diseño:
 *   - Lista los grupos existentes con sus opciones.
 *   - Permite agregar/editar/eliminar grupo (código kebab, etiqueta, obligatorio).
 *   - Permite agregar/editar/eliminar opción (insumo, cantidad, unidad, merma, etiqueta).
 *   - Todas las operaciones pasan por /api/recetas/[id]/grupos/* y refrescan.
 *
 * Reutilizable en /dashboard/recetas/[id]/page.tsx.
 */

import { useCallback, useEffect, useState } from "react";

type Insumo = { id: string; nombre: string; sku: string; unidad_medida: string };
type Opcion = {
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
type Grupo = {
  id: string;
  codigo: string;
  etiqueta: string;
  obligatorio: boolean;
  orden: number;
  opciones: Opcion[];
};

export default function GruposVarianteEditor({ recetaId }: { recetaId: string }) {
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refrescar = useCallback(async () => {
    setError(null);
    try {
      const [gRes, iRes] = await Promise.all([
        fetch(`/api/recetas/${recetaId}/grupos`, { credentials: "include" }).then((r) => r.json()),
        fetch(`/api/recetas/productos?filtro=insumos`, { credentials: "include" }).then((r) => r.json()),
      ]);
      if (gRes?.success) setGrupos(gRes.data.grupos ?? []);
      else throw new Error(gRes?.error ?? "No se pudieron cargar los grupos.");
      if (iRes?.success) setInsumos(iRes.data.productos ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [recetaId]);

  useEffect(() => { refrescar(); }, [refrescar]);

  async function crearGrupo(codigo: string, etiqueta: string) {
    const r = await fetch(`/api/recetas/${recetaId}/grupos`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo, etiqueta, obligatorio: true, orden: grupos.length * 10 }),
    });
    const j = await r.json();
    if (!r.ok || !j?.success) { setError(j?.error ?? "No se pudo crear el grupo."); return; }
    refrescar();
  }

  async function eliminarGrupo(gid: string) {
    if (!confirm("¿Eliminar este grupo y todas sus opciones?")) return;
    const r = await fetch(`/api/recetas/${recetaId}/grupos/${gid}`, { method: "DELETE", credentials: "include" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j?.error ?? "No se pudo eliminar."); return; }
    refrescar();
  }

  async function crearOpcion(gid: string, insumo_producto_id: string, etiqueta: string, cantidad: number, unidad_medida: string) {
    const r = await fetch(`/api/recetas/${recetaId}/grupos/${gid}/opciones`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ insumo_producto_id, etiqueta, cantidad, unidad_medida, merma_pct: 0, orden: 0 }),
    });
    const j = await r.json();
    if (!r.ok || !j?.success) { setError(j?.error ?? "No se pudo crear la opción."); return; }
    refrescar();
  }

  async function eliminarOpcion(gid: string, oid: string) {
    const r = await fetch(`/api/recetas/${recetaId}/grupos/${gid}/opciones/${oid}`, { method: "DELETE", credentials: "include" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j?.error ?? "No se pudo eliminar."); return; }
    refrescar();
  }

  if (loading) return <div className="text-sm text-gray-500">Cargando grupos…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Variantes obligatorias</h3>
        <button
          type="button"
          onClick={() => {
            const codigo = prompt("Código del grupo (minúsculas, sin espacios):");
            if (!codigo) return;
            const etiqueta = prompt("Etiqueta visible (ej: 'Chocolate'):");
            if (!etiqueta) return;
            crearGrupo(codigo, etiqueta);
          }}
          className="text-sm rounded bg-gray-900 text-white px-3 py-1"
        >
          + Agregar grupo
        </button>
      </div>
      {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">{error}</div>}
      {grupos.length === 0 && <div className="text-sm text-gray-500">Sin grupos de variantes. Las recetas sin grupos no piden selección en caja.</div>}
      {grupos.map((g) => (
        <div key={g.id} className="rounded-lg border border-gray-200 p-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="font-medium">{g.etiqueta}</span>
              <span className="ml-2 text-xs text-gray-500">({g.codigo}{g.obligatorio ? " · obligatorio" : ""})</span>
            </div>
            <button
              type="button"
              onClick={() => eliminarGrupo(g.id)}
              className="text-xs text-rose-700 hover:underline"
            >
              Eliminar grupo
            </button>
          </div>
          <div className="space-y-1 mb-2">
            {g.opciones.length === 0 && <div className="text-xs text-gray-500">Sin opciones aún.</div>}
            {g.opciones.map((o) => (
              <div key={o.id} className="flex items-center justify-between text-sm py-1 border-b border-gray-100">
                <div>
                  <span className="font-medium">{o.etiqueta}</span>
                  <span className="ml-2 text-xs text-gray-500">
                    · {o.cantidad} {o.unidad_medida} ·{" "}
                    {o.insumo_nombre ?? "insumo"} {o.insumo_sku ? `(${o.insumo_sku})` : ""}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => eliminarOpcion(g.id, o.id)}
                  className="text-xs text-gray-500 hover:text-rose-700"
                >
                  Eliminar
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              const etiqueta = prompt("Etiqueta de la opción (ej: 'Chocolate blanco'):");
              if (!etiqueta) return;
              const insumoId = prompt("ID del insumo (ver combo abajo):\n" + insumos.map((i) => `${i.sku} · ${i.nombre} · ${i.id}`).join("\n"));
              if (!insumoId) return;
              const ins = insumos.find((i) => i.id === insumoId);
              if (!ins) { setError("Insumo no encontrado"); return; }
              const cantidadStr = prompt(`Cantidad en ${ins.unidad_medida}:`);
              if (!cantidadStr) return;
              const cantidad = Number(cantidadStr);
              if (!(cantidad > 0)) { setError("Cantidad inválida"); return; }
              crearOpcion(g.id, insumoId, etiqueta, cantidad, ins.unidad_medida);
            }}
            className="text-xs rounded bg-emerald-600 text-white px-2 py-1"
          >
            + Agregar opción
          </button>
        </div>
      ))}
    </div>
  );
}
