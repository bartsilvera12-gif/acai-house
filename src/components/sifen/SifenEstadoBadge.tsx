"use client";

const LABELS: Record<string, string> = {
  borrador: "Borrador",
  generado: "Generado",
  firmado: "Firmado",
  enviado: "Enviado",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
};

function badgeClasses(estado: string | null): string {
  if (estado == null) {
    return "bg-slate-100 text-slate-500 border border-slate-200/80";
  }
  switch (estado) {
    case "borrador":
      return "bg-amber-50 text-amber-800 border border-amber-200";
    case "generado":
      return "bg-sky-50 text-sky-800 border border-sky-200";
    case "firmado":
      return "bg-indigo-50 text-indigo-800 border border-indigo-200";
    case "enviado":
      return "bg-violet-50 text-violet-800 border border-violet-200";
    case "aprobado":
      return "bg-emerald-50 text-emerald-800 border border-emerald-200";
    case "rechazado":
      return "bg-red-50 text-red-800 border border-red-200";
    default:
      return "bg-gray-100 text-gray-700 border border-gray-200";
  }
}

export function labelSifenEstado(estado: string | null): string {
  if (estado == null) return "Sin SIFEN";
  return LABELS[estado] ?? estado;
}

export function SifenEstadoBadge({
  estadoSifen,
  className = "",
}: {
  estadoSifen: string | null;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${badgeClasses(estadoSifen)} ${className}`}
      title={labelSifenEstado(estadoSifen)}
    >
      {labelSifenEstado(estadoSifen)}
    </span>
  );
}
