import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import {
  puedeConfigurarComisiones,
  requireComisionesModuleAccess,
} from "@/lib/comisiones/comisiones-auth";

const BASE_CALCULO = new Set(["pago_registrado", "factura_emitida", "factura_pagada"]);

export type EscalaInput = {
  desde_monto: number;
  hasta_monto?: number | null;
  porcentaje_comision: number;
  premio_fijo?: number | null;
};

/** GET — política única por empresa + escalas (requiere módulo comisiones). */
export async function GET(request: Request) {
  const auth = await requireComisionesModuleAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const { data: politica, error: ePol } = await sb
      .from("comision_politicas")
      .select("*")
      .eq("empresa_id", auth.empresaId)
      .maybeSingle();

    if (ePol) {
      return NextResponse.json(errorResponse(ePol.message), { status: 400 });
    }

    if (!politica) {
      return NextResponse.json(successResponse({ politica: null, escalas: [] }));
    }

    const pid = (politica as { id: string }).id;
    const { data: escalas, error: eEsc } = await sb
      .from("comision_escalas")
      .select("*")
      .eq("empresa_id", auth.empresaId)
      .eq("politica_id", pid)
      .order("orden", { ascending: true })
      .order("desde_monto", { ascending: true });

    if (eEsc) {
      return NextResponse.json(errorResponse(eEsc.message), { status: 400 });
    }

    return NextResponse.json(successResponse({ politica, escalas: escalas ?? [] }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/** PUT — crear/actualizar política y escalas (solo admin). */
export async function PUT(request: Request) {
  const auth = await requireComisionesModuleAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }
  if (!puedeConfigurarComisiones(auth.rol)) {
    return NextResponse.json(errorResponse("Sin permiso para configurar comisiones"), { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json(errorResponse("Body inválido"), { status: 400 });
    }

    const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
    if (!nombre) {
      return NextResponse.json(errorResponse("nombre es obligatorio"), { status: 400 });
    }

    const activo = body.activo === false ? false : true;
    const base_calculo =
      typeof body.base_calculo === "string" && BASE_CALCULO.has(body.base_calculo)
        ? body.base_calculo
        : null;
    if (!base_calculo) {
      return NextResponse.json(
        errorResponse("base_calculo debe ser pago_registrado, factura_emitida o factura_pagada"),
        { status: 400 }
      );
    }

    const timezone =
      typeof body.timezone === "string" && body.timezone.trim()
        ? body.timezone.trim()
        : "America/Asuncion";
    const modo_periodo =
      typeof body.modo_periodo === "string" && body.modo_periodo.trim()
        ? body.modo_periodo.trim()
        : "mensual_penultimo_dia_habil";

    const escalasRaw = Array.isArray(body.escalas) ? body.escalas : [];
    const escalas: EscalaInput[] = [];
    for (let i = 0; i < escalasRaw.length; i++) {
      const row = escalasRaw[i];
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const desde = Number(r.desde_monto);
      const pct = Number(r.porcentaje_comision);
      if (!Number.isFinite(desde) || !Number.isFinite(pct)) {
        return NextResponse.json(errorResponse(`Escala ${i + 1}: montos y porcentaje numéricos`), {
          status: 400,
        });
      }
      const hasta =
        r.hasta_monto === null || r.hasta_monto === undefined || r.hasta_monto === ""
          ? null
          : Number(r.hasta_monto);
      const premio =
        r.premio_fijo === null || r.premio_fijo === undefined || r.premio_fijo === ""
          ? null
          : Number(r.premio_fijo);
      if (hasta !== null && !Number.isFinite(hasta)) {
        return NextResponse.json(errorResponse(`Escala ${i + 1}: hasta_monto inválido`), {
          status: 400,
        });
      }
      if (premio !== null && !Number.isFinite(premio)) {
        return NextResponse.json(errorResponse(`Escala ${i + 1}: premio_fijo inválido`), {
          status: 400,
        });
      }
      escalas.push({
        desde_monto: desde,
        hasta_monto: hasta,
        porcentaje_comision: pct,
        premio_fijo: premio,
      });
    }

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const now = new Date().toISOString();

    const payload = {
      empresa_id: auth.empresaId,
      nombre,
      activo,
      base_calculo,
      timezone,
      modo_periodo,
      updated_at: now,
      updated_by: auth.usuarioCatalogId,
    };

    const { data: existing } = await sb
      .from("comision_politicas")
      .select("id")
      .eq("empresa_id", auth.empresaId)
      .maybeSingle();

    let politicaId: string;

    if (existing && typeof (existing as { id?: string }).id === "string") {
      politicaId = (existing as { id: string }).id;
      const { error: upErr } = await sb.from("comision_politicas").update(payload).eq("id", politicaId);
      if (upErr) {
        return NextResponse.json(errorResponse(upErr.message), { status: 400 });
      }
    } else {
      const ins = {
        ...payload,
        created_at: now,
        created_by: auth.usuarioCatalogId,
      };
      const { data: created, error: insErr } = await sb
        .from("comision_politicas")
        .insert([ins])
        .select("id")
        .single();
      if (insErr || !created) {
        return NextResponse.json(errorResponse(insErr?.message ?? "No se pudo crear la política"), {
          status: 400,
        });
      }
      politicaId = (created as { id: string }).id;
    }

    const { error: delErr } = await sb
      .from("comision_escalas")
      .delete()
      .eq("empresa_id", auth.empresaId)
      .eq("politica_id", politicaId);
    if (delErr) {
      return NextResponse.json(errorResponse(delErr.message), { status: 400 });
    }

    if (escalas.length > 0) {
      const rows = escalas.map((e, orden) => ({
        empresa_id: auth.empresaId,
        politica_id: politicaId,
        orden,
        desde_monto: e.desde_monto,
        hasta_monto: e.hasta_monto,
        porcentaje_comision: e.porcentaje_comision,
        premio_fijo: e.premio_fijo,
        updated_at: now,
      }));
      const { error: insEscErr } = await sb.from("comision_escalas").insert(rows);
      if (insEscErr) {
        return NextResponse.json(errorResponse(insEscErr.message), { status: 400 });
      }
    }

    const { data: maxVer } = await sb
      .from("comision_politica_versiones")
      .select("version_no")
      .eq("politica_id", politicaId)
      .order("version_no", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVer =
      maxVer && typeof (maxVer as { version_no?: number }).version_no === "number"
        ? (maxVer as { version_no: number }).version_no + 1
        : 1;

    const { error: verErr } = await sb.from("comision_politica_versiones").insert([
      {
        empresa_id: auth.empresaId,
        politica_id: politicaId,
        version_no: nextVer,
        nombre,
        activo,
        base_calculo,
        timezone,
        modo_periodo,
        created_by: auth.usuarioCatalogId,
      },
    ]);
    if (verErr) {
      return NextResponse.json(errorResponse(verErr.message), { status: 400 });
    }

    const { data: politica } = await sb
      .from("comision_politicas")
      .select("*")
      .eq("id", politicaId)
      .single();

    const { data: escalasOut } = await sb
      .from("comision_escalas")
      .select("*")
      .eq("politica_id", politicaId)
      .order("orden", { ascending: true });

    return NextResponse.json(successResponse({ politica, escalas: escalasOut ?? [] }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
