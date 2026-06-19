import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseServiceRoleClientOptions } from "@/lib/supabase/schema";
import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";

/**
 * Guard estándar para rutas /api/admin/*: exige sesión válida + rol super_admin
 * (o email de bootstrap). Centraliza el patrón que ya existía en DELETE para
 * que no se olvide en endpoints nuevos.
 *
 * Devuelve `{ ok: true, supabase, user }` cuando autoriza, o `{ ok: false, response }`
 * con un NextResponse listo para retornar (401 sin sesión, 403 sin rol, 500 sin
 * config). El handler debe responder con `gate.response` o seguir con `gate.supabase`.
 */
export type SuperAdminGateResult =
  | {
      ok: true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: SupabaseClient<any, any, any, any, any>;
      user: { id: string; email: string | null };
    }
  | { ok: false; response: NextResponse };

export async function requireSuperAdmin(request: Request): Promise<SuperAdminGateResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Config no disponible" }, { status: 500 }),
    };
  }

  const user = await getAuthUserForApiRoute(request);
  if (!user?.id) {
    return {
      ok: false,
      response: NextResponse.json({ error: "No autenticado" }, { status: 401 }),
    };
  }

  const supabase = createClient(url, key, { ...supabaseServiceRoleClientOptions });

  const usuario = await resolveUsuarioErpFromAuthUser(supabase, user);
  const rolSuper = (usuario?.rol ?? "").trim() === "super_admin";
  const bootstrapSuper = isBootstrapSuperAdminEmail(user.email);
  if (!rolSuper && !bootstrapSuper) {
    return {
      ok: false,
      response: NextResponse.json({ error: "No autorizado" }, { status: 403 }),
    };
  }

  return { ok: true, supabase, user: { id: user.id, email: user.email ?? null } };
}
