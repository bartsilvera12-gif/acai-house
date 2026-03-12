import type { Proveedor } from "./types";

// ─── Datos de ejemplo ─────────────────────────────────────────────────────────

const PROVEEDORES_MOCK: Proveedor[] = [
  {
    id: 1,
    nombre: "Textiles del Sur S.A.",
    ruc: "80012345-1",
    telefono: "0981 111 222",
    email: "ventas@textilesdelsur.com.py",
    direccion: "Ruta 1 km 12, Luque",
    contacto: "Carlos Mendoza",
    estado: "activo",
    fecha_creacion: "2026-01-10T08:00:00.000Z",
  },
  {
    id: 2,
    nombre: "Importadora Asunción",
    ruc: "80056789-2",
    telefono: "021 456 789",
    email: "info@importadoraasuncion.com.py",
    direccion: "Avda. Mariscal López 1500, Asunción",
    contacto: "Laura Giménez",
    estado: "activo",
    fecha_creacion: "2026-01-15T09:30:00.000Z",
  },
  {
    id: 3,
    nombre: "Distribuidora Norte SRL",
    ruc: "80098765-3",
    telefono: "0991 333 444",
    email: "contacto@disnorte.com.py",
    direccion: "Mcal. Estigarribia 320, Concepción",
    contacto: "Pedro Ávalos",
    estado: "inactivo",
    fecha_creacion: "2026-02-01T10:00:00.000Z",
  },
];

// ─── Clave de localStorage ────────────────────────────────────────────────────

const KEY = "neura_proveedores";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeGet<T>(key: string, fallback: T): T {
  try {
    const item = localStorage.getItem(key);
    return item ? (JSON.parse(item) as T) : fallback;
  } catch {
    return fallback;
  }
}

function safeSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage no disponible
  }
}

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Devuelve todos los proveedores. Si no hay datos guardados,
 * inicializa con los mocks y los persiste para futuras ediciones.
 */
export function getProveedores(): Proveedor[] {
  const stored = safeGet<Proveedor[]>(KEY, []);
  if (stored.length === 0) {
    safeSet(KEY, PROVEEDORES_MOCK);
    return PROVEEDORES_MOCK;
  }
  return stored;
}

/**
 * Comprueba si ya existe un proveedor con el mismo RUC (case-insensitive).
 * Devuelve el proveedor encontrado o null.
 */
export function proveedorExiste(ruc: string): Proveedor | null {
  const todos = getProveedores();
  return todos.find((p) => p.ruc.toLowerCase() === ruc.toLowerCase()) ?? null;
}

/**
 * Guarda un nuevo proveedor en localStorage.
 */
export function saveProveedor(datos: Omit<Proveedor, "id" | "fecha_creacion">): Proveedor {
  const nuevo: Proveedor = {
    id: Date.now(),
    fecha_creacion: new Date().toISOString(),
    ...datos,
  };
  const existentes = getProveedores();
  safeSet(KEY, [...existentes, nuevo]);
  return nuevo;
}
