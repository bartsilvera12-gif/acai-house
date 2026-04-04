import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserAndEmpresa } from "@/lib/middleware/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { loadValidatedSifenPayload } from "@/lib/sifen/load-factura-payload";
import { mapPayloadBaseToSifenDocumento } from "@/lib/sifen/map-to-sifen";
import { buildSifenDraftXml } from "@/lib/sifen/xml";
import {
  buildSifenXmlObjectPath,
  ensureSifenStorageBucket,
  removeSifenObject,
  SIFEN_STORAGE_BUCKET,
  uploadSifenXml,
} from "@/lib/sifen/sifen-storage";
import type {
  FacturaElectronicaDTO,
  SifenApiXmlGeneracionDetalle,
  SifenXmlGeneracionResponseData,
} from "@/lib/sifen/types";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase no configurado");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

const ESTADOS_BLOQUEADOS_XML = new Set<string>(["aprobado", "enviado", "firmado"]);

/**
 * POST /api/facturas/[id]/sifen/xml
 * Genera XML borrador, lo sube a Storage y actualiza factura_electronica (sin firma ni SET).
 */
export async function POST(
  request: NextRequest,
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

    const debugXml = request.nextUrl.searchParams.get("debug") === "1";

    const supabase = getSupabase();
    const fid = facturaId.trim();

    const { data: feSnapshot, error: errSnap } = await supabase
      .from("factura_electronica")
      .select("id, xml_path, estado_sifen")
      .eq("factura_id", fid)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errSnap) {
      return NextResponse.json(errorResponse(errSnap.message), { status: 400 });
    }
    if (!feSnapshot) {
      return NextResponse.json(
        errorResponse(
          "No existe registro electrónico para esta factura. Cree primero el borrador con POST /api/facturas/{id}/sifen/borrador."
        ),
        { status: 400 }
      );
    }

    if (ESTADOS_BLOQUEADOS_XML.has(String(feSnapshot.estado_sifen))) {
      return NextResponse.json(
        errorResponse(
          `No se puede regenerar el XML: el documento está en estado "${feSnapshot.estado_sifen}".`
        ),
        { status: 409 }
      );
    }

    const loaded = await loadValidatedSifenPayload(supabase, auth.empresa_id, fid);
    if (!loaded.ok) {
      return NextResponse.json(errorResponse(loaded.error.message), {
        status: loaded.error.status,
      });
    }

    if (loaded.payload.sifen.factura_electronica_id !== feSnapshot.id) {
      return NextResponse.json(errorResponse("Inconsistencia entre factura electrónica y payload."), {
        status: 500,
      });
    }

    const documentoPreparado = mapPayloadBaseToSifenDocumento(loaded.payload);
    documentoPreparado.identificacion.estado_sifen = "generado";

    const xmlString = buildSifenDraftXml(documentoPreparado);
    const objectPath = buildSifenXmlObjectPath(auth.empresa_id, fid);

    const bucketOk = await ensureSifenStorageBucket(supabase);
    if (!bucketOk.ok) {
      return NextResponse.json(errorResponse(`Storage SIFEN: ${bucketOk.message}`), { status: 500 });
    }

    const up = await uploadSifenXml(supabase, objectPath, xmlString);
    if (!up.ok) {
      return NextResponse.json(
        errorResponse(`No se pudo guardar el XML en storage: ${up.message}`),
        { status: 500 }
      );
    }

    const previousEstado = String(feSnapshot.estado_sifen ?? "borrador");
    const previousXmlPath =
      feSnapshot.xml_path === null || feSnapshot.xml_path === undefined
        ? null
        : String(feSnapshot.xml_path);

    const { data: updatedRow, error: errUpdate } = await supabase
      .from("factura_electronica")
      .update({
        xml_path: objectPath,
        estado_sifen: "generado",
      })
      .eq("id", feSnapshot.id)
      .eq("empresa_id", auth.empresa_id)
      .select()
      .single();

    if (errUpdate || !updatedRow) {
      await removeSifenObject(supabase, objectPath);
      return NextResponse.json(
        errorResponse(
          errUpdate?.message ??
            "No se pudo actualizar factura_electronica; el archivo subido fue eliminado."
        ),
        { status: 500 }
      );
    }

    const detalle: SifenApiXmlGeneracionDetalle = {
      origen: "api_xml",
      factura_id: fid,
      xml_path: objectPath,
    };

    const { error: errEvento } = await supabase.from("factura_electronica_evento").insert({
      empresa_id: auth.empresa_id,
      factura_electronica_id: feSnapshot.id,
      tipo: "generacion",
      detalle,
    });

    if (errEvento) {
      await supabase
        .from("factura_electronica")
        .update({
          xml_path: previousXmlPath,
          estado_sifen: previousEstado,
        })
        .eq("id", feSnapshot.id)
        .eq("empresa_id", auth.empresa_id);
      await removeSifenObject(supabase, objectPath);
      return NextResponse.json(
        errorResponse(`No se pudo registrar el evento; se revirtió el estado y el archivo: ${errEvento.message}`),
        { status: 500 }
      );
    }

    const data: SifenXmlGeneracionResponseData = {
      factura_electronica: updatedRow as FacturaElectronicaDTO,
      xml_path: objectPath,
      storage_bucket: SIFEN_STORAGE_BUCKET,
    };
    if (debugXml) {
      data.xml = xmlString;
    }

    return NextResponse.json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
