"use client";

/**
 * Fase 2.2 Parte 4 — Selector de variantes obligatorias para una línea de venta.
 *
 * Reglas:
 *   - El cajero debe elegir EXPLÍCITAMENTE una opción por cada grupo obligatorio.
 *   - No hay preselección automática (aunque el grupo tenga es_default): el cajero
 *     siempre hace click para confirmar — evita errores por default olvidado.
 *   - La selección no cambia el precio del producto.
 *   - `onChange` emite el array completo de `{ grupo_id, opcion_id }`.
 *   - `isCompleto(seleccion, grupos)` indica si todos los obligatorios están OK —
 *     el padre usa este hook para habilitar/deshabilitar "Agregar a la venta".
 */

import { useMemo } from "react";

export type GrupoOpcionUi = {
  id: string;
  etiqueta: string;
  insumo_nombre: string | null;
  insumo_sku: string | null;
  cantidad: number;
  unidad_medida: string;
};

export type GrupoUi = {
  id: string;
  codigo: string;
  etiqueta: string;
  obligatorio: boolean;
  orden: number;
  opciones: GrupoOpcionUi[];
};

export type Seleccion = { grupo_id: string; opcion_id: string };

export function seleccionCompleta(grupos: GrupoUi[], seleccion: Seleccion[]): boolean {
  const seleccionados = new Map(seleccion.map((s) => [s.grupo_id, s.opcion_id]));
  for (const g of grupos) {
    if (!g.obligatorio) continue;
    const opId = seleccionados.get(g.id);
    if (!opId) return false;
    if (!g.opciones.some((o) => o.id === opId)) return false;
  }
  return true;
}

export function gruposFaltantes(grupos: GrupoUi[], seleccion: Seleccion[]): string[] {
  const seleccionados = new Map(seleccion.map((s) => [s.grupo_id, s.opcion_id]));
  return grupos
    .filter((g) => g.obligatorio && !seleccionados.get(g.id))
    .map((g) => g.etiqueta);
}

export default function RecetaVariantesPicker({
  grupos,
  seleccion,
  onChange,
}: {
  grupos: GrupoUi[];
  seleccion: Seleccion[];
  onChange: (next: Seleccion[]) => void;
}) {
  const gruposOrdenados = useMemo(() => [...grupos].sort((a, b) => a.orden - b.orden), [grupos]);
  const mapaSeleccion = useMemo(() => new Map(seleccion.map((s) => [s.grupo_id, s.opcion_id])), [seleccion]);

  if (gruposOrdenados.length === 0) return null;

  function elegir(grupo_id: string, opcion_id: string) {
    const otros = seleccion.filter((s) => s.grupo_id !== grupo_id);
    onChange([...otros, { grupo_id, opcion_id }]);
  }

  return (
    <div className="space-y-4">
      {gruposOrdenados.map((g) => {
        const actual = mapaSeleccion.get(g.id);
        const faltante = g.obligatorio && !actual;
        return (
          <div
            key={g.id}
            className={
              "rounded-lg border p-3 " +
              (faltante ? "border-rose-300 bg-rose-50" : "border-gray-200 bg-white")
            }
            data-testid={`variante-grupo-${g.codigo}`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium text-sm">
                {g.etiqueta}
                {g.obligatorio && <span className="ml-1 text-rose-600">*</span>}
              </div>
              {faltante && (
                <div className="text-xs text-rose-700">Elegí una opción</div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {g.opciones
                .slice()
                .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta))
                .map((o) => {
                  const isSelected = actual === o.id;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => elegir(g.id, o.id)}
                      className={
                        "rounded-full px-3 py-1 text-sm border transition " +
                        (isSelected
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50")
                      }
                      data-testid={`variante-opcion-${o.id}`}
                      aria-pressed={isSelected}
                    >
                      {o.etiqueta}
                    </button>
                  );
                })}
            </div>
            {actual && (
              <div className="mt-2 text-xs text-gray-500">
                {(() => {
                  const op = g.opciones.find((x) => x.id === actual);
                  if (!op) return null;
                  return (
                    <>
                      Consumirá {op.cantidad} {op.unidad_medida}
                      {op.insumo_nombre ? ` de ${op.insumo_nombre}` : ""}
                      {op.insumo_sku ? ` (${op.insumo_sku})` : ""}.
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
