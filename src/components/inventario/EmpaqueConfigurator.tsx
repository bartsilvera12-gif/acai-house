"use client";

/**
 * Fase 2.1 — Configurador de empaque de compra.
 * Reemplaza los 3 inputs libres (unidad_compra/unidad_receta/factor_compra_receta)
 * por controles estructurados con equivalencia calculada automáticamente.
 *
 * Fallback: si el producto tiene valores legacy en texto libre que no matchean
 * un formato reconocido, los muestra en modo "manual" para no bloquear la edición.
 */
import { useEffect, useMemo, useState } from "react";
import {
  TIPOS_EMPAQUE,
  etiquetaEmpaque,
  factorEmpaque,
  parseEmpaque,
  type Empaque,
  type TipoEmpaque,
} from "@/lib/unidades/convert";

export interface EmpaqueConfiguratorValue {
  unidad_compra: string | null;
  unidad_receta: string | null;
  factor_compra_receta: number;
  peso_variable: boolean;
}

export interface EmpaqueConfiguratorProps {
  value: EmpaqueConfiguratorValue;
  onChange: (v: EmpaqueConfiguratorValue) => void;
  /** Opcional: estilos consistentes con el formulario padre. */
  labelClass?: string;
  inputClass?: string;
  disabled?: boolean;
}

const UNIDADES_RECETA = [
  { v: "G", label: "Gramos (g)" },
  { v: "KG", label: "Kilogramos (kg)" },
  { v: "ML", label: "Mililitros (ml)" },
  { v: "L", label: "Litros (l)" },
  { v: "UNIDAD", label: "Unidad" },
];

// Unidad base recomendada para cada tipo de empaque.
function unidadContenidoSugerida(tipo: TipoEmpaque): string {
  switch (tipo) {
    case "Caja":
    case "Bolsa":
    case "Paquete":
      return "KG"; // la gran mayoría pesan
    case "Tira":
      return "UNIDAD";
    case "Kilogramo":
      return "KG";
    case "Unidad":
      return "UNIDAD";
    default:
      return "UNIDAD";
  }
}

function unidadRecetaCompatible(unidadContenido: string): string {
  const u = (unidadContenido ?? "").toUpperCase();
  if (u === "KG" || u === "G") return "G";
  if (u === "L" || u === "LT" || u === "ML") return "ML";
  return "UNIDAD";
}

export function EmpaqueConfigurator(props: EmpaqueConfiguratorProps) {
  const { value, onChange, labelClass, inputClass, disabled } = props;

  // Si la etiqueta libre existente parsea bien, arrancamos en modo estructurado.
  // Si no (texto raro, legacy), modo manual.
  const parseado = useMemo(() => parseEmpaque(value.unidad_compra), [value.unidad_compra]);
  const [modo, setModo] = useState<"estructurado" | "manual">(
    value.unidad_compra && !parseado ? "manual" : "estructurado",
  );

  const [tipo, setTipo] = useState<TipoEmpaque>(parseado?.tipo ?? "Kilogramo");
  const [contenido, setContenido] = useState<string>(
    String(parseado?.contenido ?? 1),
  );
  const [unidadContenido, setUnidadContenido] = useState<string>(
    parseado?.unidad_contenido ?? unidadContenidoSugerida("Kilogramo"),
  );
  const [unidadReceta, setUnidadReceta] = useState<string>(
    value.unidad_receta || unidadRecetaCompatible(parseado?.unidad_contenido ?? "KG"),
  );
  const [pesoVariable, setPesoVariable] = useState<boolean>(value.peso_variable === true);
  const [manualUnidadCompra, setManualUnidadCompra] = useState<string>(value.unidad_compra ?? "");
  const [manualFactor, setManualFactor] = useState<string>(String(value.factor_compra_receta || 1));

  // Reset derivados al cambiar de tipo.
  useEffect(() => {
    if (modo !== "estructurado") return;
    const sugerida = unidadContenidoSugerida(tipo);
    setUnidadContenido(sugerida);
    setUnidadReceta(unidadRecetaCompatible(sugerida));
    if (tipo === "Kilogramo") setContenido("1");
    if (tipo === "Unidad") setContenido("1");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo]);

  // Calcular etiqueta + factor y emitir cambio.
  useEffect(() => {
    if (modo === "manual") {
      onChange({
        unidad_compra: manualUnidadCompra.trim() || null,
        unidad_receta: value.unidad_receta ?? null,
        factor_compra_receta: Math.max(parseFloat(manualFactor) || 1, 0.0001),
        peso_variable: pesoVariable,
      });
      return;
    }
    const cont = Number(contenido.replace(",", ".")) || 0;
    const empaque: Empaque = {
      tipo,
      contenido: cont,
      unidad_contenido: unidadContenido,
    };
    const etiqueta = etiquetaEmpaque(empaque);
    const factor = factorEmpaque(empaque, unidadReceta);
    onChange({
      unidad_compra: etiqueta,
      unidad_receta: unidadReceta || null,
      factor_compra_receta: factor != null && factor > 0 ? factor : 1,
      peso_variable: pesoVariable,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo, tipo, contenido, unidadContenido, unidadReceta, pesoVariable, manualUnidadCompra, manualFactor]);

  const factorPreview = useMemo(() => {
    if (modo === "manual") return Math.max(parseFloat(manualFactor) || 1, 0.0001);
    const cont = Number(contenido.replace(",", ".")) || 0;
    const f = factorEmpaque({ tipo, contenido: cont, unidad_contenido: unidadContenido }, unidadReceta);
    return f && f > 0 ? f : null;
  }, [modo, tipo, contenido, unidadContenido, unidadReceta, manualFactor]);

  const previewLabel = useMemo(() => {
    if (modo === "manual") return value.unidad_compra ?? "—";
    const cont = Number(contenido.replace(",", ".")) || 0;
    return etiquetaEmpaque({ tipo, contenido: cont, unidad_contenido: unidadContenido });
  }, [modo, tipo, contenido, unidadContenido, value.unidad_compra]);

  const _label = labelClass ?? "block text-xs font-medium text-gray-700 mb-1";
  const _input = inputClass ?? "w-full rounded-md border border-gray-300 px-3 py-2 text-sm";

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-800">Empaque de compra</h4>
        <button
          type="button"
          onClick={() => setModo(modo === "estructurado" ? "manual" : "estructurado")}
          className="text-xs text-amber-700 hover:underline"
          disabled={disabled}
        >
          {modo === "estructurado" ? "Carga manual" : "Carga guiada"}
        </button>
      </div>

      {modo === "estructurado" ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className={_label}>Tipo de empaque</label>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoEmpaque)}
                className={_input}
                disabled={disabled}
              >
                {TIPOS_EMPAQUE.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={_label}>Contenido</label>
              <input
                type="number"
                step="0.001"
                min="0"
                value={contenido}
                onChange={(e) => setContenido(e.target.value)}
                className={_input}
                disabled={disabled || tipo === "Kilogramo" || tipo === "Unidad"}
              />
            </div>
            <div>
              <label className={_label}>Unidad contenido</label>
              <select
                value={unidadContenido}
                onChange={(e) => setUnidadContenido(e.target.value)}
                className={_input}
                disabled={disabled || tipo === "Kilogramo" || tipo === "Unidad"}
              >
                <option value="KG">kg</option>
                <option value="G">g</option>
                <option value="L">l</option>
                <option value="ML">ml</option>
                <option value="UNIDAD">unidad</option>
              </select>
            </div>
            <div>
              <label className={_label}>Unidad de consumo</label>
              <select
                value={unidadReceta}
                onChange={(e) => setUnidadReceta(e.target.value)}
                className={_input}
                disabled={disabled}
              >
                {UNIDADES_RECETA.map((u) => (
                  <option key={u.v} value={u.v}>{u.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="rounded-md bg-white px-3 py-2 text-xs text-gray-600 border border-gray-200">
            <div><strong>Resultado:</strong> 1 × {previewLabel}</div>
            <div className="mt-1">
              = <strong>{factorPreview != null ? factorPreview.toLocaleString("es-PY") : "no convertible"}</strong>{" "}
              <span className="text-gray-500">{unidadReceta.toLowerCase()}</span>
              {factorPreview == null && (
                <span className="ml-2 text-amber-700">
                  — unidades no compatibles. Elegí otra unidad de consumo o usá carga manual.
                </span>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-1">
            <label className={_label}>Unidad de compra (texto)</label>
            <input
              type="text"
              value={manualUnidadCompra}
              onChange={(e) => setManualUnidadCompra(e.target.value)}
              placeholder='Ej: "Bolsa 25kg"'
              className={_input}
              disabled={disabled}
            />
          </div>
          <div>
            <label className={_label}>Unidad de receta</label>
            <input
              type="text"
              value={unidadReceta}
              onChange={(e) => setUnidadReceta(e.target.value)}
              placeholder='Ej: "g"'
              className={_input}
              disabled={disabled}
            />
          </div>
          <div>
            <label className={_label}>Factor compra → receta</label>
            <input
              type="number"
              step="0.0001"
              min="0.0001"
              value={manualFactor}
              onChange={(e) => setManualFactor(e.target.value)}
              className={_input}
              disabled={disabled}
            />
          </div>
        </div>
      )}

      <label className="inline-flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
        <input
          type="checkbox"
          checked={pesoVariable}
          onChange={(e) => setPesoVariable(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
          disabled={disabled}
        />
        <span>
          Peso variable (ej: caja de banana). Al comprar se pedirá el peso real recibido y no se usará este factor.
        </span>
      </label>
    </div>
  );
}
