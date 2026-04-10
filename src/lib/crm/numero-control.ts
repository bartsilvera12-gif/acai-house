import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Reutiliza la misma lógica de numeración que el CRM:
 *  - busca el último numero_control
 *  - parsea CRM-XXXX
 *  - incrementa y vuelve a formatear CRM-000001
 */
export async function generarNumeroControlFromSupabase(sb: AppSupabaseClient): Promise<string> {
  const { data } = await sb
    .from("crm_prospectos")
    .select("numero_control")
    .order("created_at", { ascending: false })
    .limit(1);

  const last = data?.[0] as { numero_control?: string } | undefined;
  const match = last?.numero_control?.match(/CRM-(\d+)/);
  const next = (parseInt(match?.[1] ?? "0", 10) + 1);
  return `CRM-${String(next).padStart(6, "0")}`;
}

