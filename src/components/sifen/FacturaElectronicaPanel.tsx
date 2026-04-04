"use client";

import { useCallback, useState } from "react";
import type { FacturaElectronicaDTO } from "@/lib/sifen/types";
import { SifenEstadoBadge, labelSifenEstado } from "./SifenEstadoBadge";

type Resumen = {
  sifen_config_exists: boolean;
  sifen_config_activa: boolean;
  factura_electronica: FacturaElectronicaDTO | null;
};

const XML_BLOQUEADOS = new Set(["aprobado", "enviado", "firmado"]);
const FIRMAR_BLOQUEADOS = new Set(["aprobado", "enviado"]);

async function readApiError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string };
    return j.error ?? `Error ${res.status}`;
  } catch {
    return `Error ${res.status}`;
  }
}

export function FacturaElectronicaPanel({
  facturaId,
  resumen,
  loadingResumen,
  onResumenLoaded,
}: {
  facturaId: string;
  resumen: Resumen | null;
  loadingResumen: boolean;
  onResumenLoaded: (r: Resumen) => void;
}) {
  const [action, setAction] = useState<"borrador" | "xml" | "firmar" | null>(null);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/facturas/${facturaId}/sifen/resumen`);
    const j = (await res.json()) as { success?: boolean; data?: Resumen };
    if (res.ok && j.success && j.data) onResumenLoaded(j.data);
  }, [facturaId, onResumenLoaded]);

  const run = async (kind: "borrador" | "xml" | "firmar") => {
    setFlash(null);
    setAction(kind);
    try {
      const path =
        kind === "borrador"
          ? `/api/facturas/${facturaId}/sifen/borrador`
          : kind === "xml"
            ? `/api/facturas/${facturaId}/sifen/xml`
            : `/api/facturas/${facturaId}/sifen/firmar`;
      const res = await fetch(path, { method: "POST" });
      if (!res.ok) {
        setFlash({ kind: "err", text: await readApiError(res) });
        return;
      }
      setFlash({
        kind: "ok",
        text:
          kind === "borrador"
            ? "Borrador electrónico listo."
            : kind === "xml"
              ? "XML generado correctamente."
              : "XML firmado correctamente.",
      });
      await refresh();
    } catch (e) {
      setFlash({ kind: "err", text: e instanceof Error ? e.message : "Error de red" });
    } finally {
      setAction(null);
    }
  };

  const fe = resumen?.factura_electronica ?? null;
  const estado = fe?.estado_sifen ?? null;
  const estadoLabel = fe ? labelSifenEstado(estado) : "Sin SIFEN";

  const puedeBorrador = Boolean(resumen?.sifen_config_activa) && !fe;
  const puedeGenerarXml =
    Boolean(resumen?.sifen_config_activa) && fe != null && !XML_BLOQUEADOS.has(String(estado));
  const puedeFirmar =
    Boolean(resumen?.sifen_config_activa) &&
    fe != null &&
    Boolean(fe.xml_path?.trim()) &&
    !FIRMAR_BLOQUEADOS.has(String(estado)) &&
    estado !== "firmado";

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-4">
      <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide border-b border-slate-100 pb-2">
        Facturación electrónica (SIFEN)
      </h3>

      {loadingResumen && (
        <p className="text-sm text-slate-400">Cargando estado SIFEN…</p>
      )}

      {!loadingResumen && resumen && !resumen.sifen_config_exists && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3">
          No hay configuración SIFEN para esta empresa. La factura comercial no se ve afectada. Configurá SIFEN en{" "}
          <a href="/configuracion/facturacion-electronica" className="font-semibold underline hover:no-underline">
            Configuración → Facturación electrónica
          </a>
          .
        </div>
      )}

      {!loadingResumen && resumen?.sifen_config_exists && !resumen.sifen_config_activa && (
        <div className="rounded-lg bg-slate-50 border border-slate-200 text-slate-700 text-sm px-4 py-3">
          La configuración SIFEN existe pero está <strong>desactivada</strong>. Activála para generar borradores y XML desde aquí.
        </div>
      )}

      {!loadingResumen && resumen && (
        <>
          <div className="grid gap-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-500">Estado SIFEN:</span>
              <SifenEstadoBadge estadoSifen={fe ? estado : null} />
              {!fe && <span className="text-slate-400">({estadoLabel})</span>}
            </div>
            {fe && (
              <>
                <p className="text-slate-600">
                  <span className="text-slate-400">ID documento electrónico:</span>{" "}
                  <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{fe.id}</code>
                </p>
                <p className="text-slate-600 break-all">
                  <span className="text-slate-400">xml_path:</span>{" "}
                  <code className="text-xs">{fe.xml_path ?? "—"}</code>
                </p>
                <p className="text-slate-600 break-all">
                  <span className="text-slate-400">xml_firmado_path:</span>{" "}
                  <code className="text-xs">{fe.xml_firmado_path ?? "—"}</code>
                </p>
                {fe.cdc && (
                  <p className="text-slate-600 break-all">
                    <span className="text-slate-400">CDC:</span> <code className="text-xs">{fe.cdc}</code>
                  </p>
                )}
                {fe.error && (
                  <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm px-3 py-2 whitespace-pre-wrap">
                    <span className="font-semibold">Error: </span>
                    {fe.error}
                  </div>
                )}
              </>
            )}
          </div>

          {flash && (
            <div
              className={`rounded-lg text-sm px-4 py-2 ${
                flash.kind === "ok"
                  ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                  : "bg-red-50 border border-red-200 text-red-800"
              }`}
            >
              {flash.text}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={!puedeBorrador || action !== null}
              onClick={() => run("borrador")}
              className="px-3 py-2 text-xs font-semibold rounded-lg bg-slate-900 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800"
            >
              {action === "borrador" ? "Generando…" : "Generar borrador"}
            </button>
            <button
              type="button"
              disabled={!puedeGenerarXml || action !== null}
              onClick={() => run("xml")}
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
            >
              {action === "xml"
                ? "Generando XML…"
                : fe?.xml_path?.trim()
                  ? "Regenerar XML"
                  : "Generar XML"}
            </button>
            <button
              type="button"
              disabled={!puedeFirmar || action !== null}
              onClick={() => run("firmar")}
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-indigo-300 text-indigo-900 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-indigo-50"
            >
              {action === "firmar" ? "Firmando…" : "Firmar XML"}
            </button>
          </div>

          {fe && (
            <div className="text-xs text-slate-400 pt-2 border-t border-slate-100 space-y-1">
              <p>
                Debug:{" "}
                <a className="text-[#0EA5E9] hover:underline" href={`/api/facturas/${facturaId}/sifen/payload`} target="_blank" rel="noreferrer">
                  payload JSON
                </a>
                {" · "}
                <a className="text-[#0EA5E9] hover:underline" href={`/api/facturas/${facturaId}/sifen/documento`} target="_blank" rel="noreferrer">
                  documento
                </a>
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
