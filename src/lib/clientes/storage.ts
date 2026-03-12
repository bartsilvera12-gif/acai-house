import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import type { Cliente, EstadoCliente, NotaCliente } from "./types";

// ─── Tipo de fila Supabase ────────────────────────────────────────────────────
// Columnas actuales: id (uuid), empresa_id (uuid), nombre, telefono, email,
//                   direccion, created_at

interface SupabaseRow {
  id:          string;
  nombre:      string | null;
  telefono:    string | null;
  email:       string | null;
  direccion:   string | null;
  created_at:  string | null;
}

// ─── Mapping fila → Cliente ───────────────────────────────────────────────────

function rowToCliente(row: SupabaseRow): Cliente {
  const now = new Date().toISOString();
  return {
    id:              row.id,
    codigo_cliente:  `CL-${row.id.slice(0, 6).toUpperCase()}`,
    tipo_cliente:    "empresa",
    nombre_contacto: row.nombre    ?? "",
    telefono:        row.telefono  ?? undefined,
    email:           row.email     ?? undefined,
    direccion:       row.direccion ?? undefined,
    origen:          "MANUAL",
    estado:          "activo",
    notas:           getNotasCliente(row.id),
    created_at:      row.created_at ?? now,
    updated_at:      row.created_at ?? now,
  };
}

// ─── Notas (localStorage, indexadas por id de cliente) ───────────────────────

export function getNotasCliente(clienteId: string): NotaCliente[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(`neura_notas_${clienteId}`) ?? "[]") as NotaCliente[];
  } catch { return []; }
}

function saveNotasCliente(clienteId: string, notas: NotaCliente[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(`neura_notas_${clienteId}`, JSON.stringify(notas));
}

// ─── API pública ──────────────────────────────────────────────────────────────

export async function getClientes(): Promise<Cliente[]> {
  const usuario = await getCurrentUser();
  if (!usuario) throw new Error("Usuario no autenticado");

  const { data, error } = await supabase
    .from("clientes")
    .select("*")
    .eq("empresa_id", usuario.empresa_id)
    .order("created_at", { ascending: false });

  if (error) { console.error("[clientes] getClientes:", error.message); return []; }
  return (data as SupabaseRow[]).map(rowToCliente);
}

export async function getCliente(id: string): Promise<Cliente | null> {
  const { data, error } = await supabase
    .from("clientes")
    .select("*")
    .eq("id", id)
    .single();

  if (error) { console.error("[clientes] getCliente:", error.message); return null; }
  return rowToCliente(data as SupabaseRow);
}

export async function getClienteByProspectoId(
  _prospectoId: number
): Promise<Cliente | null> {
  return null; // Sin columna prospecto_id en Supabase por ahora
}

export type NuevoClienteData = Omit<
  Cliente,
  "id" | "codigo_cliente" | "notas" | "created_at" | "updated_at"
>;

export async function saveCliente(datos: NuevoClienteData): Promise<Cliente | null> {
  const usuario = await getCurrentUser();
  if (!usuario) throw new Error("Usuario no autenticado");

  const { data, error } = await supabase
    .from("clientes")
    .insert([{
      empresa_id: usuario.empresa_id,
      nombre:     datos.nombre_contacto            || null,
      telefono:   datos.telefono                   || null,
      email:      datos.email                      || null,
      direccion:  datos.direccion                  || null,
    }])
    .select()
    .single();

  if (error) { console.error("[clientes] saveCliente:", error.message); return null; }
  return rowToCliente(data as SupabaseRow);
}

export async function updateCliente(
  id: string,
  datos: Partial<Omit<Cliente, "id" | "codigo_cliente" | "created_at">>
): Promise<Cliente | null> {
  const patch: Partial<SupabaseRow> = {};
  if (datos.nombre_contacto !== undefined) patch.nombre    = datos.nombre_contacto || null;
  if (datos.telefono        !== undefined) patch.telefono  = datos.telefono        || null;
  if (datos.email           !== undefined) patch.email     = datos.email           || null;
  if (datos.direccion       !== undefined) patch.direccion = datos.direccion       || null;

  const { data, error } = await supabase
    .from("clientes")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) { console.error("[clientes] updateCliente:", error.message); return null; }
  return rowToCliente(data as SupabaseRow);
}

export async function deleteCliente(id: string): Promise<void> {
  const { error } = await supabase.from("clientes").delete().eq("id", id);
  if (error) console.error("[clientes] deleteCliente:", error.message);
}

export function addNotaCliente(clienteId: string, texto: string): NotaCliente {
  const nota: NotaCliente = {
    id:    Date.now(),
    texto: texto.trim(),
    fecha: new Date().toISOString(),
  };
  const notas = getNotasCliente(clienteId);
  saveNotasCliente(clienteId, [...notas, nota]);
  return nota;
}

export async function toggleEstado(id: string, estado: EstadoCliente): Promise<void> {
  await updateCliente(id, { estado });
}

/** Nombre de display según tipo de cliente. */
export function clienteNombre(c: Cliente): string {
  return c.tipo_cliente === "empresa" && c.empresa ? c.empresa : c.nombre_contacto;
}
