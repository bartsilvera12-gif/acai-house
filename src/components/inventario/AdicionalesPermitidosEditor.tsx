"use client";

/**
 * Editor de adicionales permitidos por producto.
 * Semántica: si el usuario no marca ninguno, todos los adicionales activos aplican
 * ("modo permisivo"). Si marca uno o más, SÓLO esos aparecen en caja al vender este producto.
 *
 * Se usa en la página de edición del producto. La carga inicial y la persistencia
 * contra /api/productos/:id/adicionales-permitidos las maneja el contenedor.
 */

interface AdicionalMin {
  id: string;
  nombre: string;
  precio: number;
}

interface Props {
  catalogo: AdicionalMin[];
  seleccionados: Set<string>;
  onChange: (next: Set<string>) => void;
  /** True mientras no hubo GET inicial exitoso. */
  loaded: boolean;
}

function formatGs(v: number): string {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}

export default function AdicionalesPermitidosEditor({ catalogo, seleccionados, onChange, loaded }: Props) {
  function toggle(id: string) {
    const next = new Set(seleccionados);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }
  function limpiar() {
    onChange(new Set());
  }

  const modoRestringido = seleccionados.size > 0;

  if (catalogo.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-600">
        Todavía no hay adicionales cargados. Creá los adicionales desde la caja o desde el catálogo
        (Fase posterior) para poder restringir por producto.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!loaded && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span>⚠</span>
          <span>
            No pudimos cargar la lista actual de adicionales permitidos. Los cambios acá
            <strong> no se guardarán</strong> hasta que recargues la página.
          </span>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          {modoRestringido
            ? `En caja, este producto mostrará sólo ${seleccionados.size} adicional${seleccionados.size === 1 ? "" : "es"}.`
            : "En caja, este producto muestra todos los adicionales activos (modo permisivo)."}
        </p>
        {modoRestringido && (
          <button
            type="button"
            onClick={limpiar}
            className="shrink-0 text-xs text-sky-700 hover:text-sky-900 underline"
          >
            Volver a &ldquo;todos aplican&rdquo;
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {catalogo.map((a) => {
          const marcado = seleccionados.has(a.id);
          return (
            <label
              key={a.id}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                marcado
                  ? "border-emerald-300 bg-emerald-50"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <input
                type="checkbox"
                checked={marcado}
                onChange={() => toggle(a.id)}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-slate-800 truncate">{a.nombre}</span>
                <span className="block text-[11px] tabular-nums text-slate-500">+{formatGs(a.precio)}</span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
