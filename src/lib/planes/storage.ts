import type { EstadoPlan, Plan } from "./types";

// ─── Datos de ejemplo ─────────────────────────────────────────────────────────

const PLANES_MOCK: Plan[] = [
  {
    id:              1,
    codigo_plan:     "PLAN-0001",
    nombre:          "BÁSICO",
    descripcion:     "Plan de entrada ideal para pequeñas empresas.",
    precio:          150000,
    moneda:          "GS",
    periodicidad:    "mensual",
    limite_usuarios: 2,
    limite_clientes: 50,
    limite_facturas: 100,
    estado:          "activo",
    created_at:      "2026-01-01T00:00:00.000Z",
    updated_at:      "2026-01-01T00:00:00.000Z",
  },
  {
    id:              2,
    codigo_plan:     "PLAN-0002",
    nombre:          "PROFESIONAL",
    descripcion:     "Para empresas en crecimiento con mayor volumen de operaciones.",
    precio:          350000,
    moneda:          "GS",
    periodicidad:    "mensual",
    limite_usuarios: 10,
    limite_clientes: 500,
    limite_facturas: 1000,
    estado:          "activo",
    created_at:      "2026-01-01T00:00:00.000Z",
    updated_at:      "2026-01-01T00:00:00.000Z",
  },
  {
    id:              3,
    codigo_plan:     "PLAN-0003",
    nombre:          "ENTERPRISE",
    descripcion:     "Solución completa sin límites para grandes organizaciones.",
    precio:          99,
    moneda:          "USD",
    periodicidad:    "mensual",
    limite_usuarios: null,
    limite_clientes: null,
    limite_facturas: null,
    estado:          "activo",
    created_at:      "2026-01-01T00:00:00.000Z",
    updated_at:      "2026-01-01T00:00:00.000Z",
  },
  {
    id:              4,
    codigo_plan:     "PLAN-0004",
    nombre:          "STARTER ANUAL",
    descripcion:     "Plan básico con descuento por pago anual.",
    precio:          1500000,
    moneda:          "GS",
    periodicidad:    "anual",
    limite_usuarios: 2,
    limite_clientes: 50,
    limite_facturas: 100,
    estado:          "inactivo",
    created_at:      "2026-01-01T00:00:00.000Z",
    updated_at:      "2026-01-01T00:00:00.000Z",
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const KEY = "neura_planes";

function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function safeSet<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // silent
  }
}

function getBase(): Plan[] {
  const stored = safeGet<Plan[]>(KEY, []);
  if (stored.length === 0) {
    return PLANES_MOCK.map((p) => ({ ...p }));
  }
  return stored;
}

function generarCodigo(planes: Plan[]): string {
  const max = planes.reduce((m, p) => {
    const n = parseInt(p.codigo_plan.replace("PLAN-", ""), 10) || 0;
    return n > m ? n : m;
  }, 0);
  return `PLAN-${String(max + 1).padStart(4, "0")}`;
}

// ─── API pública ──────────────────────────────────────────────────────────────

export function getPlanes(): Plan[] {
  return getBase();
}

export function getPlan(id: number): Plan | undefined {
  return getBase().find((p) => p.id === id);
}

export type NuevoPlanData = Omit<Plan, "id" | "codigo_plan" | "created_at" | "updated_at">;

export function savePlan(datos: NuevoPlanData): Plan {
  const planes = getBase();
  const maxId  = planes.reduce((m, p) => (p.id > m ? p.id : m), 0);
  const now    = new Date().toISOString();

  const nuevo: Plan = {
    ...datos,
    id:          maxId + 1,
    codigo_plan: generarCodigo(planes),
    created_at:  now,
    updated_at:  now,
  };

  safeSet(KEY, [...planes, nuevo]);
  return nuevo;
}

export function updatePlan(
  id: number,
  datos: Partial<Omit<Plan, "id" | "codigo_plan" | "created_at">>
): Plan | null {
  const planes = getBase();
  const idx    = planes.findIndex((p) => p.id === id);
  if (idx === -1) return null;

  const actualizado: Plan = {
    ...planes[idx],
    ...datos,
    updated_at: new Date().toISOString(),
  };

  planes[idx] = actualizado;
  safeSet(KEY, planes);
  return actualizado;
}

export function toggleEstadoPlan(id: number, estado: EstadoPlan): void {
  updatePlan(id, { estado });
}

export function deletePlan(id: number): void {
  const planes = getBase().filter((p) => p.id !== id);
  safeSet(KEY, planes);
}

export function planNombre(p: Plan): string {
  return p.nombre;
}
