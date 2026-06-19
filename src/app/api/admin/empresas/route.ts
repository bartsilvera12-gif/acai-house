import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-super-admin";

/**
 * Lista todas las empresas del catálogo. SOLO super_admin (rol o bootstrap).
 * Antes no validaba auth → cualquiera podía pegarle al endpoint y recibir
 * el catálogo completo (datos sensibles via service role).
 */
export async function GET(request: Request) {
  try {
    const gate = await requireSuperAdmin(request);
    if (!gate.ok) return gate.response;

    const { data, error } = await gate.supabase
      .from("empresas")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
