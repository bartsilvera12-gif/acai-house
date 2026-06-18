"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { registrarPerdida } from "@/lib/inventario/storage";
import type { Producto } from "@/lib/inventario/types";

interface Props {
  producto: Pick<Producto, "id" | "nombre" | "sku" | "costo_promedio" | "stock_actual" | "unidad_medida">;
  /** Se llama tras registrar la pérdida, con el nuevo stock resultante. */
  onRegistrado?: (nuevoStock: number) => void;
}

// Motivos frecuentes de pérdida en gastronomía (materias primas).
const MOTIVOS = ["Vencido", "Dañado / golpeado", "Mal estado", "Derrame", "Robo / faltante", "Otro"] as const;

export default function MarcarPerdidaCard({ producto, onRegistrado }: Props) {
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState<string>("");
  const [motivoOtro, setMotivoOtro] = useState("");
  const [stockActual, setStockActual] = useState(producto.stock_actual);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const cantidadNum = Math.abs(parseFloat(cantidad)) || 0;
  const excede = cantidadNum > stockActual;
  const valorPerdida = cantidadNum * (producto.costo_promedio || 0);
  const motivoFinal = motivo === "Otro" ? motivoOtro.trim() : motivo;
  const puedeRegistrar = cantidadNum > 0 && !excede && !enviando;

  const inputClass =
    "w-full border border-gray-300 rounded-lg px-4 py-3 outline-none focus:border-gray-500 transition-colors text-sm";
  const labelClass = "block text-sm font-medium text-gray-700 mb-2";

  async function handleRegistrar() {
    if (!puedeRegistrar) return;
    setError(null);
    setOkMsg(null);
    setEnviando(true);
    try {
      const mov = await registrarPerdida({
        producto: {
          id: producto.id,
          nombre: producto.nombre,
          sku: producto.sku,
          costo_promedio: producto.costo_promedio,
        },
        cantidad: cantidadNum,
        motivo: motivoFinal || null,
      });
      if (!mov) {
        setError("No se pudo registrar la pérdida. Intentá nuevamente.");
        return;
      }
      const nuevoStock = Math.max(0, stockActual - cantidadNum);
      setStockActual(nuevoStock);
      onRegistrado?.(nuevoStock);
      setOkMsg(
        `Pérdida registrada: ${cantidadNum} ${producto.unidad_medida || "uds."}. Stock actualizado a ${nuevoStock}.`
      );
      setCantidad("");
      setMotivo("");
      setMotivoOtro("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al registrar la pérdida.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-6 max-w-5xl">
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle className="w-5 h-5 text-amber-600" />
        <h2 className="text-lg font-semibold text-gray-900">Registrar pérdida / merma</h2>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        Dá de baja stock que se perdió (vencido, dañado, desperdicio). Genera un movimiento de salida
        para hacer seguimiento de lo perdido en el mes. No afecta el precio de venta.
      </p>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {okMsg && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {okMsg}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label className={labelClass}>
            Cantidad a dar por perdida
            <span className="ml-2 text-xs font-normal text-gray-400">
              (stock actual: {stockActual} {producto.unidad_medida || "uds."})
            </span>
          </label>
          <input
            type="number"
            min={0}
            step="any"
            max={stockActual}
            value={cantidad}
            onChange={(e) => {
              setCantidad(e.target.value);
              setError(null);
              setOkMsg(null);
            }}
            placeholder="Ej: 3"
            className={`${inputClass} ${excede ? "border-red-400" : ""}`}
          />
          {excede && (
            <p className="mt-1 text-xs text-red-600">No podés perder más de {stockActual} en stock.</p>
          )}
        </div>

        <div>
          <label className={labelClass}>
            Motivo <span className="text-xs font-normal text-gray-400">(opcional)</span>
          </label>
          <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className={inputClass}>
            <option value="">Sin especificar</option>
            {MOTIVOS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {motivo === "Otro" && (
            <input
              type="text"
              value={motivoOtro}
              onChange={(e) => setMotivoOtro(e.target.value)}
              placeholder="Detalle del motivo"
              className={`${inputClass} mt-2`}
            />
          )}
        </div>
      </div>

      {cantidadNum > 0 && !excede && (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
          <span className="text-gray-600">Valor estimado de la pérdida (al costo)</span>
          <span className="font-semibold tabular-nums text-amber-700">
            Gs. {Math.round(valorPerdida).toLocaleString("es-PY")}
          </span>
        </div>
      )}

      <div className="mt-5">
        <button
          type="button"
          onClick={handleRegistrar}
          disabled={!puedeRegistrar}
          className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {enviando ? "Registrando…" : "Registrar pérdida"}
        </button>
      </div>
    </div>
  );
}
