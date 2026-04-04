import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserAndEmpresa } from "@/lib/middleware/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { loadValidatedSifenPayload } from "@/lib/sifen/load-factura-payload";
import { mapPayloadBaseToSifenDocumento } from "@/lib/sifen/map-to-sifen";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase no configurado");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * GET /api/facturas/[id]/sifen/documento
 * Payload base ERP mapeado a estructura interna previa al XML SIFEN (sin SET).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getUserAndEmpresa();
    if (!auth) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }

    const { id: facturaId } = await params;
    if (!facturaId?.trim()) {
      return NextResponse.json(errorResponse("id de factura es obligatorio"), { status: 400 });
    }

    const supabase = getSupabase();
    const loaded = await loadValidatedSifenPayload(supabase, auth.empresa_id, facturaId);

    if (!loaded.ok) {
      return NextResponse.json(errorResponse(loaded.error.message), {
        status: loaded.error.status,
      });
    }

    const documento = mapPayloadBaseToSifenDocumento(loaded.payload);
    return NextResponse.json(successResponse(documento));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
