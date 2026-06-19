"use client";

import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { swrFetch, invalidateSwr } from "@/lib/client-cache/swr-fetch";

/**
 * Forma de `/api/auth/empresa-context` (es_admin, rol, empresa_id).
 *
 * Estable durante toda la sesión — no es necesario re-fetchearlo en cada
 * página. signIn/signOut limpian la cache global SWR (ver lib/auth.ts).
 */
export type EmpresaContext = {
  es_admin: boolean;
  rol: string | null;
  empresa_id: string | null;
};

const SWR_EMPRESA_CONTEXT = "/api/auth/empresa-context";

/** Devuelve el contexto de empresa del usuario actual o `null` si falla.
 * Cacheado con SWR (15 min) + dedupe en vuelo. */
export async function getEmpresaContext(): Promise<EmpresaContext | null> {
  return swrFetch<EmpresaContext | null>(
    SWR_EMPRESA_CONTEXT,
    async () => {
      try {
        const res = await fetchWithSupabaseSession("/api/auth/empresa-context");
        if (!res.ok) return null;
        const json = (await res.json()) as {
          success?: boolean;
          data?: Partial<EmpresaContext>;
        };
        if (!json.success || !json.data) return null;
        return {
          es_admin: Boolean(json.data.es_admin),
          rol: json.data.rol != null && json.data.rol !== "" ? String(json.data.rol) : null,
          empresa_id: json.data.empresa_id ?? null,
        };
      } catch {
        return null;
      }
    },
    15 * 60_000,
  );
}

export function invalidateEmpresaContext(): void {
  invalidateSwr(SWR_EMPRESA_CONTEXT);
}
