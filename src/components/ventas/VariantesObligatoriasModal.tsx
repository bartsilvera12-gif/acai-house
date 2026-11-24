"use client";

/**
 * Fase 2.2 Parte 4 — Modal de selección de variantes obligatorias.
 *
 * Se abre cuando el cajero acaba de armar una línea (producto+presentación+
 * cantidad+adicionales) y el combo tiene grupos obligatorios en su receta.
 * El cajero elige una opción por grupo; el botón "Confirmar y agregar" queda
 * deshabilitado hasta que todos los grupos obligatorios estén completos.
 *
 * Soporta dos modos:
 *   - "Nuevo" (agregar al carrito): confirmar emite la selección al padre.
 *   - "Editar" (línea ya en carrito): precarga la selección existente y
 *     emite la nueva. El padre reemplaza la selección anterior.
 */

import { useCallback, useEffect, useState } from "react";
import RecetaVariantesPicker, {
  type GrupoUi,
  type Seleccion,
  seleccionCompleta,
  gruposFaltantes,
} from "./RecetaVariantesPicker";

export default function VariantesObligatoriasModal({
  abierto,
  productoNombre,
  presentacionNombre,
  grupos,
  seleccionInicial = [],
  onConfirmar,
  onCancelar,
}: {
  abierto: boolean;
  productoNombre: string;
  presentacionNombre: string | null;
  grupos: GrupoUi[];
  seleccionInicial?: Seleccion[];
  onConfirmar: (s: Seleccion[]) => void;
  onCancelar: () => void;
}) {
  const [seleccion, setSeleccion] = useState<Seleccion[]>(seleccionInicial);

  useEffect(() => { setSeleccion(seleccionInicial); }, [seleccionInicial, abierto]);

  const completo = seleccionCompleta(grupos, seleccion);
  const faltantes = gruposFaltantes(grupos, seleccion);

  const confirmar = useCallback(() => {
    if (!completo) return;
    onConfirmar(seleccion);
  }, [completo, onConfirmar, seleccion]);

  if (!abierto) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="variantes-titulo"
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="p-4 border-b border-gray-200">
          <h2 id="variantes-titulo" className="text-base font-semibold text-gray-900">
            {productoNombre}
            {presentacionNombre ? <span className="text-gray-500 font-normal"> · {presentacionNombre}</span> : null}
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Elegí una opción por cada grupo obligatorio. Las variantes están incluidas en el precio.
          </p>
        </div>
        <div className="p-4 max-h-[60vh] overflow-y-auto">
          <RecetaVariantesPicker grupos={grupos} seleccion={seleccion} onChange={setSeleccion} />
        </div>
        <div className="p-4 border-t border-gray-200 flex items-center justify-between gap-3">
          <div className="text-xs">
            {completo ? (
              <span className="text-emerald-700">Selección completa</span>
            ) : (
              <span className="text-rose-700">Falta: {faltantes.join(", ")}</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancelar}
              className="rounded-md border border-gray-300 bg-white text-gray-700 px-3 py-2 text-sm hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmar}
              disabled={!completo}
              className={
                "rounded-md px-4 py-2 text-sm text-white " +
                (completo ? "bg-emerald-600 hover:bg-emerald-700" : "bg-gray-300 cursor-not-allowed")
              }
              data-testid="confirmar-variantes"
            >
              Confirmar y agregar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
