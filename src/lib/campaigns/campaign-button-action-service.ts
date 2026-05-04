import "server-only";
import type { SupabaseAdmin } from "@/lib/chat/types";
import { createFlowEngine } from "@/lib/chat/flow-engine-service";
import {
  insertActiveFlowSessionRow,
  markConversationActiveSessionsEnded,
} from "@/lib/chat/flow-session-service";
import { normalizeWaPhone } from "@/lib/chat/wa-phone";
import { digitsInternational } from "@/lib/campaigns/campaign-phone";
import { campaignReplyLookbackMs } from "@/lib/campaigns/campaign-inbound-hook";
import {
  FLOW_POINTER_RESET_EVENT,
  getFirstActiveNodeCodeForFlow,
  isFlowKnownAndActiveInCatalog,
  isNodeActiveInFlow,
} from "@/lib/chat/resolve-whatsapp-active-flow";
import {
  resolveOutboundTextContextFromConversationId,
  sendOutboundTextMessage,
} from "@/lib/chat/outbound-send-dispatch";

const LOG_RX = "[campaign-button-action][received]";
const LOG_MT = "[campaign-button-action][matched]";
const LOG_EX = "[campaign-button-action][executed]";
const LOG_NA = "[campaign-button-action][no-action]";
const LOG_ER = "[campaign-button-action][error]";
const LOG_ID = "[campaign-button-action][idempotent-skip]";

const DEBOUNCE_MS = 45_000;

export type CampaignButtonActionRow = {
  id: string;
  empresa_id: string;
  campaign_id: string;
  button_id: string;
  button_label: string | null;
  action_type: "none" | "start_flow" | "send_text";
  flow_code: string | null;
  start_node_code: string | null;
  text_body: string | null;
  metadata: Record<string, unknown>;
};

function inboundButtonReplyId(raw: Record<string, unknown>): string | null {
  const intr = raw.interactive as
    | { button_reply?: { id?: string }; list_reply?: { id?: string } }
    | undefined;
  if (!intr || typeof intr !== "object") return null;
  const id = intr.button_reply?.id?.trim();
  return id || null;
}

function inboundButtonReplyTitle(raw: Record<string, unknown>): string | null {
  const intr = raw.interactive as { button_reply?: { title?: string } } | undefined;
  const t = intr?.button_reply?.title?.trim();
  return t || null;
}

/** Coincidencia estable para Meta (case / espacios); sin depender de unicode-property escapes. */
function normalizeButtonToken(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function actionMatchesInbound(
  action: CampaignButtonActionRow,
  buttonId: string,
  buttonTitle: string | null
): boolean {
  if (action.action_type === "none") return false;
  const nid = normalizeButtonToken(buttonId);
  if (normalizeButtonToken(action.button_id) === nid) return true;
  if (buttonTitle) {
    const nt = normalizeButtonToken(buttonTitle);
    if (normalizeButtonToken(action.button_id) === nt) return true;
    if (action.button_label && normalizeButtonToken(action.button_label) === nt) return true;
  }
  return false;
}

async function findMatchingRecipientForButton(params: {
  supabase: SupabaseAdmin;
  empresaId: string;
  channelId: string;
  phoneDigits: string;
  inboundMs: number;
  buttonId: string;
  buttonTitle: string | null;
}): Promise<{ recipient: { id: string; campaign_id: string; sent_at: string | null }; action: CampaignButtonActionRow } | null> {
  const lookbackMs = campaignReplyLookbackMs();
  const lookbackStartIso = new Date(params.inboundMs - lookbackMs).toISOString();
  const inboundIso = new Date(params.inboundMs).toISOString();
  const phoneCandidates = Array.from(
    new Set([`+${params.phoneDigits}`, params.phoneDigits].filter(Boolean))
  );

  const { data: campaigns, error: campErr } = await params.supabase
    .from("chat_campaigns")
    .select("id")
    .eq("empresa_id", params.empresaId)
    .eq("channel_id", params.channelId)
    .neq("status", "cancelled");

  if (campErr || !campaigns?.length) return null;

  const campaignIds = (campaigns as { id: string }[]).map((c) => c.id);

  const recipientsBase = () =>
    params.supabase
      .from("chat_campaign_recipients")
      .select("id, campaign_id, status, phone_e164, sent_at")
      .eq("empresa_id", params.empresaId)
      .in("campaign_id", campaignIds)
      .in("status", ["sent", "replied"])
      .not("sent_at", "is", null)
      .lte("sent_at", inboundIso)
      .gte("sent_at", lookbackStartIso);

  let { data: rows, error: rErr } = await recipientsBase()
    .in("phone_e164", phoneCandidates)
    .order("sent_at", { ascending: false });

  if (rErr || !rows?.length) {
    const fb = await recipientsBase()
      .ilike("phone_e164", `%${params.phoneDigits}%`)
      .order("sent_at", { ascending: false });
    rows = fb.data;
    rErr = fb.error;
  }

  if (rErr || !rows?.length) return null;

  const actionsCache = new Map<string, CampaignButtonActionRow[]>();

  async function actionsForCampaign(campaignId: string): Promise<CampaignButtonActionRow[]> {
    if (actionsCache.has(campaignId)) return actionsCache.get(campaignId)!;
    const { data, error } = await params.supabase
      .from("chat_campaign_button_actions")
      .select("*")
      .eq("empresa_id", params.empresaId)
      .eq("campaign_id", campaignId);
    if (error) {
      actionsCache.set(campaignId, []);
      return [];
    }
    const list = (data ?? []) as CampaignButtonActionRow[];
    actionsCache.set(campaignId, list);
    return list;
  }

  type R = {
    id: string;
    campaign_id: string;
    status: string;
    phone_e164: string;
    sent_at: string | null;
  };

  for (const r of rows as R[]) {
    const d = normalizeWaPhone(digitsInternational(r.phone_e164));
    if (d !== params.phoneDigits) continue;
    if (!r.sent_at) continue;
    const sentMs = Date.parse(r.sent_at);
    if (Number.isNaN(sentMs) || sentMs > params.inboundMs) continue;
    if (params.inboundMs - sentMs > lookbackMs) continue;

    const actions = await actionsForCampaign(r.campaign_id);
    const action = actions.find((a) =>
      actionMatchesInbound(a, params.buttonId, params.buttonTitle)
    );
    if (!action) continue;

    return { recipient: { id: r.id, campaign_id: r.campaign_id, sent_at: r.sent_at }, action };
  }

  return null;
}

async function shouldSkipIdempotent(params: {
  supabase: SupabaseAdmin;
  empresaId: string;
  campaignId: string;
  conversationId: string;
  buttonId: string;
  waMessageId: string | null | undefined;
  actionType: string;
}): Promise<boolean> {
  if (params.waMessageId) {
    const { data: evDup } = await params.supabase
      .from("chat_campaign_events")
      .select("event_payload_json")
      .eq("empresa_id", params.empresaId)
      .eq("campaign_id", params.campaignId)
      .eq("event_type", "campaign_button_action_executed")
      .order("created_at", { ascending: false })
      .limit(40);
    const dupHit = (evDup ?? []).some(
      (row) =>
        String((row.event_payload_json as Record<string, unknown> | undefined)?.wa_message_id ?? "") ===
        params.waMessageId
    );
    if (dupHit) return true;
  }

  const since = new Date(Date.now() - DEBOUNCE_MS).toISOString();
  const { data: recent } = await params.supabase
    .from("chat_campaign_events")
    .select("id, created_at, event_payload_json")
    .eq("empresa_id", params.empresaId)
    .eq("campaign_id", params.campaignId)
    .eq("event_type", "campaign_button_action_executed")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20);

  for (const ev of recent ?? []) {
    const p = ev.event_payload_json as Record<string, unknown> | null;
    if (!p || typeof p !== "object") continue;
    if (String(p.conversation_id ?? "") !== params.conversationId) continue;
    if (String(p.button_id ?? "") !== params.buttonId) continue;
    if (String(p.action_type ?? "") !== params.actionType) continue;
    return true;
  }

  return false;
}

async function recordExecuted(params: {
  supabase: SupabaseAdmin;
  empresaId: string;
  campaignId: string;
  recipientId: string;
  contactId: string;
  conversationId: string;
  buttonId: string;
  actionType: string;
  flowCode: string | null;
  startNodeCode: string | null;
  waMessageId: string | null;
  detail?: Record<string, unknown>;
}) {
  await params.supabase.from("chat_campaign_events").insert({
    empresa_id: params.empresaId,
    campaign_id: params.campaignId,
    recipient_id: params.recipientId,
    event_type: "campaign_button_action_executed",
    event_payload_json: {
      contact_id: params.contactId,
      conversation_id: params.conversationId,
      button_id: params.buttonId,
      action_type: params.actionType,
      flow_code: params.flowCode,
      start_node_code: params.startNodeCode,
      wa_message_id: params.waMessageId ?? null,
      ...(params.detail ?? {}),
    },
  });
}

/**
 * Tras guardar el inbound y marcar RESPONDIERON: si es clic quick reply y hay acción configurada, ejecuta.
 * Devuelve handled=true cuando conviene omitir `processInteractiveReply` del flow engine (start_flow / send_text).
 */
export async function tryHandleCampaignButtonAction(params: {
  supabase: SupabaseAdmin;
  empresaId: string;
  channelId: string;
  conversationId: string;
  contactId: string;
  inboundAtIso: string;
  waMessageId?: string | null;
  rawPayload: Record<string, unknown>;
}): Promise<{ handled: boolean }> {
  const buttonId = inboundButtonReplyId(params.rawPayload);
  const buttonTitle = inboundButtonReplyTitle(params.rawPayload);
  if (!buttonId) {
    const intr = params.rawPayload.interactive as { button_reply?: unknown } | undefined;
    if (intr?.button_reply) {
      console.info(LOG_NA, {
        reason: "missing_button_reply_id",
        empresa_id: params.empresaId,
        conversation_id: params.conversationId,
        received_button_title: buttonTitle,
      });
    }
    return { handled: false };
  }

  console.info(LOG_RX, {
    empresa_id: params.empresaId,
    conversation_id: params.conversationId,
    contact_id: params.contactId,
    button_id: buttonId,
    button_title: buttonTitle,
    wa_message_id: params.waMessageId ?? null,
  });

  const { data: contact, error: cErr } = await params.supabase
    .from("chat_contacts")
    .select("phone_number")
    .eq("id", params.contactId)
    .eq("empresa_id", params.empresaId)
    .maybeSingle();

  if (cErr || !contact) {
    console.info(LOG_NA, { reason: "contact_not_found", empresa_id: params.empresaId });
    return { handled: false };
  }

  const phoneDigits = normalizeWaPhone((contact as { phone_number?: string }).phone_number ?? "");
  if (!phoneDigits) {
    console.info(LOG_NA, { reason: "contact_phone_empty", empresa_id: params.empresaId });
    return { handled: false };
  }

  const inboundMs = Date.parse(params.inboundAtIso);
  if (Number.isNaN(inboundMs)) {
    console.info(LOG_NA, { reason: "bad_inbound_ts", empresa_id: params.empresaId });
    return { handled: false };
  }

  const matched = await findMatchingRecipientForButton({
    supabase: params.supabase,
    empresaId: params.empresaId,
    channelId: params.channelId,
    phoneDigits,
    inboundMs,
    buttonId,
    buttonTitle,
  });

  if (!matched) {
    console.info(LOG_NA, {
      empresa_id: params.empresaId,
      channel_id: params.channelId,
      contact_id: params.contactId,
      received_button_id: buttonId,
      received_button_title: buttonTitle,
      reason: "no_recipient_or_no_action",
    });
    return { handled: false };
  }

  const { recipient, action } = matched;

  console.info(LOG_MT, {
    empresa_id: params.empresaId,
    campaign_id: recipient.campaign_id,
    recipient_id: recipient.id,
    contact_id: params.contactId,
    button_id: buttonId,
    action_type: action.action_type,
    flow_code: action.flow_code ?? null,
    start_node_code: action.start_node_code ?? null,
  });

  if (action.action_type === "none") {
    console.info(LOG_NA, { reason: "action_none", campaign_id: recipient.campaign_id });
    return { handled: false };
  }

  const skip = await shouldSkipIdempotent({
    supabase: params.supabase,
    empresaId: params.empresaId,
    campaignId: recipient.campaign_id,
    conversationId: params.conversationId,
    buttonId,
    waMessageId: params.waMessageId,
    actionType: action.action_type,
  });

  if (skip) {
    console.info(LOG_ID, {
      empresa_id: params.empresaId,
      campaign_id: recipient.campaign_id,
      recipient_id: recipient.id,
      button_id: buttonId,
      action_type: action.action_type,
    });
    return {
      handled: action.action_type === "start_flow" || action.action_type === "send_text",
    };
  }

  try {
    if (action.action_type === "send_text") {
      const body = String(action.text_body ?? "").trim();
      const ctx = await resolveOutboundTextContextFromConversationId(
        params.supabase,
        params.conversationId,
        params.empresaId
      );
      const send = await sendOutboundTextMessage(ctx, body.slice(0, 4096));
      if (!send.ok) {
        console.warn(LOG_ER, {
          empresa_id: params.empresaId,
          campaign_id: recipient.campaign_id,
          error: send.error ?? "send_failed",
        });
        return { handled: false };
      }
      await recordExecuted({
        supabase: params.supabase,
        empresaId: params.empresaId,
        campaignId: recipient.campaign_id,
        recipientId: recipient.id,
        contactId: params.contactId,
        conversationId: params.conversationId,
        buttonId,
        actionType: "send_text",
        flowCode: null,
        startNodeCode: null,
        waMessageId: params.waMessageId ?? null,
        detail: { outbound_ok: true },
      });
      console.info(LOG_EX, {
        empresa_id: params.empresaId,
        campaign_id: recipient.campaign_id,
        recipient_id: recipient.id,
        contact_id: params.contactId,
        button_id: buttonId,
        action_type: "send_text",
      });
      return { handled: true };
    }

    if (action.action_type === "start_flow") {
      const fc = String(action.flow_code ?? "").trim();
      if (!(await isFlowKnownAndActiveInCatalog(params.supabase, params.empresaId, fc))) {
        console.warn(LOG_ER, {
          empresa_id: params.empresaId,
          campaign_id: recipient.campaign_id,
          flow_code: fc,
          reason: "flow_not_active",
        });
        return { handled: false };
      }

      let nodeCode = String(action.start_node_code ?? "").trim();
      if (nodeCode) {
        const okNode = await isNodeActiveInFlow(params.supabase, params.empresaId, fc, nodeCode);
        if (!okNode) {
          console.warn(LOG_ER, {
            empresa_id: params.empresaId,
            flow_code: fc,
            start_node_code: nodeCode,
            reason: "node_not_active",
          });
          return { handled: false };
        }
      } else {
        nodeCode =
          (await getFirstActiveNodeCodeForFlow(params.supabase, params.empresaId, fc)) ?? "inicio";
      }

      await markConversationActiveSessionsEnded(
        params.supabase,
        params.empresaId,
        params.conversationId,
        "restarted",
        "campaign_button_action"
      );

      const newSid = await insertActiveFlowSessionRow(
        params.supabase,
        params.empresaId,
        params.conversationId,
        fc
      );

      if (!newSid) {
        console.warn(LOG_ER, {
          empresa_id: params.empresaId,
          campaign_id: recipient.campaign_id,
          reason: "session_insert_failed",
        });
        return { handled: false };
      }

      const { error: upErr } = await params.supabase
        .from("chat_conversations")
        .update({
          flow_code: fc,
          flow_current_node: nodeCode,
          flow_status: "bot",
          human_taken_over: false,
          active_flow_session_id: newSid,
          updated_at: new Date().toISOString(),
        })
        .eq("id", params.conversationId)
        .eq("empresa_id", params.empresaId);

      if (upErr) {
        console.warn(LOG_ER, {
          empresa_id: params.empresaId,
          message: upErr.message,
          reason: "conversation_update_failed",
        });
        return { handled: false };
      }

      await params.supabase.from("chat_flow_events").insert({
        empresa_id: params.empresaId,
        conversation_id: params.conversationId,
        flow_code: fc,
        node_code: nodeCode,
        flow_session_id: newSid,
        event_type: FLOW_POINTER_RESET_EVENT,
        payload: {
          trigger: "campaign_button_action",
          flow_session_id: newSid,
          campaign_id: recipient.campaign_id,
          button_id: buttonId,
        },
      });

      const engine = createFlowEngine({ supabase: params.supabase });
      const sent = await engine.sendCurrentFlowNode({ conversationId: params.conversationId });
      if (!sent.ok) {
        console.warn(LOG_ER, {
          empresa_id: params.empresaId,
          campaign_id: recipient.campaign_id,
          error: sent.error ?? "sendCurrentFlowNode",
        });
      }

      await recordExecuted({
        supabase: params.supabase,
        empresaId: params.empresaId,
        campaignId: recipient.campaign_id,
        recipientId: recipient.id,
        contactId: params.contactId,
        conversationId: params.conversationId,
        buttonId,
        actionType: "start_flow",
        flowCode: fc,
        startNodeCode: nodeCode,
        waMessageId: params.waMessageId ?? null,
        detail: { flow_engine_ok: sent.ok },
      });

      console.info(LOG_EX, {
        empresa_id: params.empresaId,
        campaign_id: recipient.campaign_id,
        recipient_id: recipient.id,
        contact_id: params.contactId,
        button_id: buttonId,
        action_type: "start_flow",
        flow_code: fc,
        start_node_code: nodeCode,
      });

      return { handled: true };
    }
  } catch (e) {
    console.warn(LOG_ER, {
      empresa_id: params.empresaId,
      campaign_id: recipient.campaign_id,
      err: e instanceof Error ? e.message : String(e),
    });
    return { handled: false };
  }

  return { handled: false };
}
