import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-super-admin";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limit";

/**
 * Crea un usuario en Supabase Auth con service role. SOLO super_admin.
 *
 * Antes no validaba auth → cualquiera podía pegarle al endpoint y crear
 * usuarios en GoTrue del sistema (spam, abuso, escalación). Además
 * logueaba fragmentos de la service role key (`KEY starts with: ...`),
 * leak parcial. Ambos arreglados.
 */
export async function POST(req: Request) {
  try {
    // Rate limit por IP — incluso si alguien fuga el JWT de super_admin,
    // no puede crear miles de usuarios en segundos.
    const ip = getClientIp(req);
    if (!checkRateLimit(`create-user:${ip}`, 10, 60_000)) {
      return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });
    }

    const gate = await requireSuperAdmin(req);
    if (!gate.ok) return gate.response;

    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json(
        { error: "Email y password son requeridos" },
        { status: 400 }
      );
    }

    const { data, error } = await gate.supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ user: data.user });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    console.error("[create-user] catch:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
