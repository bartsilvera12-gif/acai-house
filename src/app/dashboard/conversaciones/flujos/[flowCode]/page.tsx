"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type FlowNodeOption = {
  id: string;
  node_id: string;
  label: string;
  option_value: string;
  meta_button_id: string;
  next_node_code: string | null;
  sort_order: number;
};

type FlowNode = {
  id: string;
  node_code: string;
  node_type: string;
  message_text: string | null;
  save_as_field: string | null;
  next_node_code: string | null;
  is_active: boolean;
  crm_action_type: string | null;
  crm_action_config: Record<string, unknown>;
  options: FlowNodeOption[];
};

function prettifyCode(code: string): string {
  return code
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function friendlyNodeTitle(node: FlowNode): string {
  const txt = node.message_text?.trim();
  if (txt) return txt.slice(0, 42) + (txt.length > 42 ? "..." : "");
  return prettifyCode(node.node_code);
}

function nodeTypeLabel(nodeType: string): string {
  switch (nodeType) {
    case "buttons":
      return "Botones";
    case "list":
      return "Lista";
    case "text":
      return "Texto libre";
    case "image_input":
      return "Imagen";
    case "human":
      return "Derivar a humano";
    case "end":
      return "Finalizar";
    default:
      return nodeType;
  }
}

function toMetaButtonId(label: string): string {
  return (
    label
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 50) || `btn_${Date.now()}`
  );
}

export default function FlowEditorPage() {
  const params = useParams<{ flowCode: string }>();
  const flowCode = decodeURIComponent(params?.flowCode ?? "");
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [newNodeCode, setNewNodeCode] = useState("");
  const [newNodeType, setNewNodeType] = useState("text");

  const nodeByCode = useMemo(
    () => new Map(nodes.map((n) => [n.node_code, n])),
    [nodes]
  );

  const orderedNodes = useMemo(() => {
    if (nodes.length <= 1) return nodes;
    const incoming = new Map<string, number>();
    for (const n of nodes) incoming.set(n.node_code, 0);
    for (const n of nodes) {
      const links = [n.next_node_code, ...n.options.map((o) => o.next_node_code)];
      for (const target of links) {
        if (!target) continue;
        if (incoming.has(target)) incoming.set(target, (incoming.get(target) ?? 0) + 1);
      }
    }

    const startCodes = nodes
      .filter((n) => (incoming.get(n.node_code) ?? 0) === 0)
      .map((n) => n.node_code);
    const visited = new Set<string>();
    const out: FlowNode[] = [];

    function walk(code: string) {
      if (visited.has(code)) return;
      visited.add(code);
      const node = nodeByCode.get(code);
      if (!node) return;
      out.push(node);
      if (node.next_node_code) walk(node.next_node_code);
      for (const opt of node.options) {
        if (opt.next_node_code) walk(opt.next_node_code);
      }
    }

    for (const start of startCodes) walk(start);
    for (const n of nodes) walk(n.node_code);
    return out;
  }, [nodes, nodeByCode]);

  const nodeCodes = useMemo(() => orderedNodes.map((n) => n.node_code), [orderedNodes]);

  function nextStepLabel(nextNodeCode: string | null): string {
    if (!nextNodeCode) return "Sin siguiente paso";
    const target = nodeByCode.get(nextNodeCode);
    if (!target) return `${prettifyCode(nextNodeCode)} (pendiente crear)`;
    return friendlyNodeTitle(target);
  }

  async function reload() {
    setLoading(true);
    try {
      const res = await fetch(`/api/chat/flows/${encodeURIComponent(flowCode)}/nodes`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        items?: FlowNode[];
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo cargar nodos");
      setNodes(json.items ?? []);
      setError(null);
      setSuccess(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [flowCode]);

  async function createNode(e: React.FormEvent) {
    e.preventDefault();
    if (!newNodeCode.trim()) return;
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/chat/flows/${encodeURIComponent(flowCode)}/nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          node_code: newNodeCode.trim(),
          node_type: newNodeType,
          message_text: "",
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo crear nodo");
      setNewNodeCode("");
      await reload();
      setSuccess(`Paso ${prettifyCode(newNodeCode.trim())} creado.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error creando nodo");
    }
  }

  async function saveNode(node: FlowNode) {
    setError(null);
    const res = await fetch(
      `/api/chat/flows/${encodeURIComponent(flowCode)}/nodes/${encodeURIComponent(node.node_code)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          node_type: node.node_type,
          message_text: node.message_text ?? "",
          save_as_field: node.save_as_field ?? null,
          next_node_code: node.next_node_code ?? null,
          is_active: node.is_active,
          crm_action_type: node.crm_action_type ?? null,
          crm_action_config: node.crm_action_config ?? {},
        }),
      }
    );
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo guardar nodo");
    setSuccess(`Paso ${prettifyCode(node.node_code)} guardado.`);
  }

  async function saveOption(node: FlowNode, opt: FlowNodeOption) {
    const metaButtonId = toMetaButtonId(opt.label);
    const res = await fetch(
      `/api/chat/flows/${encodeURIComponent(flowCode)}/nodes/${encodeURIComponent(node.node_code)}/options/${opt.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          label: opt.label,
          meta_button_id: metaButtonId,
          next_node_code: opt.next_node_code,
          sort_order: opt.sort_order,
        }),
      }
    );
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo guardar opción");
    setSuccess(`Botón "${opt.label}" guardado.`);
  }

  async function createOption(node: FlowNode) {
    const label = "Nueva opción";
    const res = await fetch(
      `/api/chat/flows/${encodeURIComponent(flowCode)}/nodes/${encodeURIComponent(node.node_code)}/options`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          label,
          meta_button_id: toMetaButtonId(label),
          next_node_code: null,
          sort_order: node.options.length + 1,
        }),
      }
    );
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo crear opción");
    setSuccess(`Opción creada en ${prettifyCode(node.node_code)}.`);
  }

  async function deleteOption(node: FlowNode, optionId: string) {
    const res = await fetch(
      `/api/chat/flows/${encodeURIComponent(flowCode)}/nodes/${encodeURIComponent(node.node_code)}/options/${optionId}`,
      { method: "DELETE", credentials: "same-origin" }
    );
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo eliminar opción");
    setSuccess("Opción eliminada.");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between gap-3 items-start">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Editor de flujo: {flowCode}</h1>
          <p className="text-sm text-slate-500">Nodos + opciones de botones + preparación CRM</p>
        </div>
        <Link
          href="/dashboard/conversaciones/flujos"
          className="text-sm font-medium text-[#0EA5E9] hover:underline px-3 py-2 rounded-lg border border-sky-200 bg-sky-50"
        >
          Volver al listado
        </Link>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</div>}
      {success && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2">{success}</div>}

      <form onSubmit={createNode} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs text-slate-500 mb-1">Nombre del paso (código interno)</label>
          <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={newNodeCode} onChange={(e) => setNewNodeCode(e.target.value)} placeholder="ej: datos_pago" />
        </div>
        <div className="min-w-[180px]">
          <label className="block text-xs text-slate-500 mb-1">Tipo de interacción</label>
          <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={newNodeType} onChange={(e) => setNewNodeType(e.target.value)}>
            <option value="buttons">buttons</option>
            <option value="list">list</option>
            <option value="text">text</option>
            <option value="image_input">image_input</option>
            <option value="human">human</option>
            <option value="end">end</option>
          </select>
        </div>
        <button type="submit" className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-4 py-2 rounded-lg text-sm font-medium">Crear nodo</button>
      </form>

      {loading ? (
        <div className="p-6 text-sm text-slate-400 animate-pulse">Cargando nodos...</div>
      ) : (
        <div className="space-y-4">
          {orderedNodes.map((node, idx) => (
            <div key={node.id} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-800">Paso #{idx + 1}: {friendlyNodeTitle(node)}</div>
                  <div className="text-xs text-slate-500">Tipo: {nodeTypeLabel(node.node_type)}</div>
                </div>
                <label className="text-sm text-slate-700 flex items-center gap-2">
                  <input type="checkbox" checked={node.is_active} onChange={(e) => setNodes((prev) => prev.map((n) => n.id === node.id ? { ...n, is_active: e.target.checked } : n))} />
                  Activo
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Nombre del paso</label>
                  <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono w-full" value={node.node_code} readOnly />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Tipo de interacción</label>
                  <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full" value={node.node_type} onChange={(e) => setNodes((prev) => prev.map((n) => n.id === node.id ? { ...n, node_type: e.target.value } : n))}>
                    <option value="buttons">Botones</option>
                    <option value="list">Lista</option>
                    <option value="text">Texto libre</option>
                    <option value="image_input">Imagen</option>
                    <option value="human">Derivar a humano</option>
                    <option value="end">Finalizar</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Siguiente paso</label>
                  <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full" value={node.next_node_code ?? ""} onChange={(e) => setNodes((prev) => prev.map((n) => n.id === node.id ? { ...n, next_node_code: e.target.value || null } : n))}>
                    <option value="">(finaliza en este paso)</option>
                    {nodeCodes.filter((code) => code !== node.node_code).map((code) => (
                      <option key={code} value={code}>{nextStepLabel(code)}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">Mensaje al cliente</label>
                <textarea className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[74px]" placeholder="Escribí el mensaje que verá el cliente" value={node.message_text ?? ""} onChange={(e) => setNodes((prev) => prev.map((n) => n.id === node.id ? { ...n, message_text: e.target.value } : n))} />
              </div>

              <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                Este paso va a → <span className="font-medium text-slate-800">{nextStepLabel(node.next_node_code)}</span>
              </div>

              <details className="border border-slate-100 rounded-lg p-3 bg-slate-50/60">
                <summary className="text-sm font-medium text-slate-700 cursor-pointer">Opciones avanzadas</summary>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Guardar respuesta como</label>
                    <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full" placeholder="ej: nombre, cedula, ciudad" value={node.save_as_field ?? ""} onChange={(e) => setNodes((prev) => prev.map((n) => n.id === node.id ? { ...n, save_as_field: e.target.value || null } : n))} />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs text-slate-500 mb-1">Acción en CRM (opcional)</label>
                    <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full" placeholder="ej: create_lead, move_funnel_stage, assign_advisor" value={node.crm_action_type ?? ""} onChange={(e) => setNodes((prev) => prev.map((n) => n.id === node.id ? { ...n, crm_action_type: e.target.value || null } : n))} />
                  </div>
                </div>
              </details>

              <button
                type="button"
                onClick={async () => {
                  try {
                    await saveNode(node);
                    await reload();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Error al guardar nodo");
                  }
                }}
                className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                Guardar paso
              </button>

              {node.node_type === "buttons" && (
                <div className="border border-slate-100 rounded-lg p-3 space-y-2 bg-slate-50/60">
                  <div className="text-xs font-semibold text-slate-600 uppercase">Botones del cliente</div>
                  {node.options.map((opt) => (
                    <div key={opt.id} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-center">
                      <div className="md:col-span-2">
                        <label className="block text-xs text-slate-500 mb-1">Texto del botón</label>
                        <input className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm w-full" value={opt.label} onChange={(e) => setNodes((prev) => prev.map((n) => n.id !== node.id ? n : ({ ...n, options: n.options.map((o) => o.id === opt.id ? { ...o, label: e.target.value } : o) } )))} placeholder="Ej: Comprar entrada" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Va a</label>
                        <select className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm w-full" value={opt.next_node_code ?? ""} onChange={(e) => setNodes((prev) => prev.map((n) => n.id !== node.id ? n : ({ ...n, options: n.options.map((o) => o.id === opt.id ? { ...o, next_node_code: e.target.value || null } : o) } )))} >
                          <option value="">(sin siguiente)</option>
                          {nodeCodes.filter((code) => code !== node.node_code).map((code) => (
                            <option key={code} value={code}>{nextStepLabel(code)}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await saveOption(node, opt);
                              await reload();
                            } catch (e) {
                              setError(e instanceof Error ? e.message : "Error al guardar botón");
                            }
                          }}
                          className="text-[#0EA5E9] hover:underline text-sm"
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await deleteOption(node, opt.id);
                              await reload();
                            } catch (e) {
                              setError(e instanceof Error ? e.message : "Error al eliminar botón");
                            }
                          }}
                          className="text-red-600 hover:underline text-sm"
                        >
                          Eliminar
                        </button>
                      </div>
                      <div className="md:col-span-4 text-xs text-slate-500 bg-white border border-slate-200 rounded px-2 py-1">
                        Botón: "{opt.label}" → va a: "{nextStepLabel(opt.next_node_code)}"
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await createOption(node);
                        await reload();
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Error al crear botón");
                      }
                    }}
                    className="text-sm text-[#0EA5E9] hover:underline"
                  >
                    + Agregar botón
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
