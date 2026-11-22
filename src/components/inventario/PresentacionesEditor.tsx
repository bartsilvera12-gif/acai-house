"use client";

/**
 * Editor inline de presentaciones (tamaños) de un producto.
 * Se usa en /inventario/nuevo y /inventario/[id]/editar.
 *
 * El componente es controlado: recibe el arreglo y un setter. El guardado contra
 * /api/productos/:id/presentaciones lo hace la página contenedora al crear/editar.
 */

import { Plus, Trash2 } from "lucide-react";
import MontoInput from "@/components/ui/MontoInput";

export interface PresentacionBorrador {
  /** Id del backend si ya existía; null para filas nuevas. */
  id: string | null;
  nombre: string;
  /** Precio en Gs. */
  precio: string;
}

interface Props {
  value: PresentacionBorrador[];
  onChange: (next: PresentacionBorrador[]) => void;
  /** Mensaje de ayuda inline cuando se agrega la primera fila. */
  hint?: string;
}

const EJEMPLOS = ["Chico", "Mediano", "Grande"];

export default function PresentacionesEditor({ value, onChange, hint }: Props) {
  function update(i: number, patch: Partial<PresentacionBorrador>) {
    const next = value.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function remove(i: number) {
    const next = value.slice();
    next.splice(i, 1);
    onChange(next);
  }
  function add() {
    const sugerencia = EJEMPLOS[value.length] ?? "";
    onChange([...value, { id: null, nombre: sugerencia, precio: "" }]);
  }

  const inputClass =
    "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white text-sm";

  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
          <p className="text-sm text-slate-600">
            El producto se vende en <strong>un solo tamaño</strong> con el precio de venta cargado arriba.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Si querés manejar varios tamaños (Chico/Mediano/Grande, etc.), agregá una presentación.
          </p>
          <button
            type="button"
            onClick={add}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm font-medium px-3 py-2"
          >
            <Plus className="w-4 h-4" />
            Agregar primera presentación
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {value.map((p, i) => (
              <div key={p.id ?? `tmp-${i}`} className="flex gap-2 items-start">
                <div className="flex-1 min-w-0">
                  <input
                    type="text"
                    value={p.nombre}
                    onChange={(e) => update(i, { nombre: e.target.value })}
                    placeholder={`Ej: ${EJEMPLOS[i] ?? "Tamaño"}`}
                    className={inputClass}
                  />
                </div>
                <div className="w-40 shrink-0">
                  <MontoInput
                    value={p.precio}
                    onChange={(n) => update(i, { precio: String(n) })}
                    placeholder="Precio (Gs.)"
                    className={inputClass}
                    decimals={false}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="shrink-0 h-[38px] w-[38px] inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50"
                  aria-label={`Quitar presentación ${p.nombre || i + 1}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={add}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-white text-sky-700 hover:bg-sky-50 text-sm font-medium px-3 py-2"
          >
            <Plus className="w-4 h-4" />
            Agregar otro tamaño
          </button>
          {hint && <p className="text-xs text-slate-400">{hint}</p>}
        </>
      )}
    </div>
  );
}
