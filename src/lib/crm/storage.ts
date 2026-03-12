import type { Prospecto, EtapaFunnel, Nota } from "./types";

// ─── Datos de ejemplo ─────────────────────────────────────────────────────────

const PROSPECTOS_MOCK: Prospecto[] = [
  {
    id: 1,
    numero_control: "CRM-000001",
    empresa:        "ACME S.A.",
    contacto:       "CARLOS RODRÍGUEZ",
    email:          "carlos@acme.com",
    telefono:       "0981-123456",
    servicio:       "Implementación ERP completa",
    valor_estimado: 45000000,
    etapa:          "LEAD",
    proxima_accion:       "Agendar reunión de presentación",
    fecha_proxima_accion: "2026-03-15",
    creado_por:     "JUAN PÉREZ",
    responsable:    "JUAN PÉREZ",
    notas: [
      {
        id:    1,
        texto: "Primer contacto vía LinkedIn. Tiene interés en el módulo de ventas e inventario.",
        fecha: "2026-03-01T09:00:00.000Z",
      },
    ],
    fecha_creacion:      "2026-03-09T09:00:00.000Z",
    fecha_actualizacion: "2026-03-09T09:00:00.000Z",
  },
  {
    id: 2,
    numero_control: "CRM-000002",
    empresa:        "TECNO CORP S.R.L.",
    contacto:       "ANA MARTÍNEZ",
    email:          "ana@tecnocorp.com",
    telefono:       "0991-234567",
    servicio:       "Módulo de compras e inventario",
    valor_estimado: 22000000,
    etapa:          "CONTACTADO",
    proxima_accion:       "Enviar propuesta comercial",
    fecha_proxima_accion: "2026-03-12",
    creado_por:     "JUAN PÉREZ",
    responsable:    "MARIA LOPEZ",
    notas: [
      {
        id:    2,
        texto: "Segunda llamada realizada. Muy interesados en el módulo de inventario.",
        fecha: "2026-03-03T14:00:00.000Z",
      },
    ],
    fecha_creacion:      "2026-02-20T10:00:00.000Z",
    fecha_actualizacion: "2026-03-03T14:00:00.000Z",
  },
  {
    id: 3,
    numero_control: "CRM-000003",
    empresa:        "DISTRIBUIDORA CENTRAL",
    contacto:       "PEDRO SILVA",
    email:          "pedro@distcentral.com",
    telefono:       "0971-345678",
    servicio:       "Sistema de facturación y CRM",
    valor_estimado: 18000000,
    etapa:          "NEGOCIACION",
    proxima_accion:       "Revisar ajustes del contrato",
    fecha_proxima_accion: "2026-03-11",
    creado_por:     "MARIA LOPEZ",
    responsable:    "MARIA LOPEZ",
    notas: [],
    fecha_creacion:      "2026-02-15T08:00:00.000Z",
    fecha_actualizacion: "2026-03-05T16:00:00.000Z",
  },
  {
    id: 4,
    numero_control: "CRM-000004",
    empresa:        "IMPORTADORA DEL SUR",
    contacto:       "LAURA GÓMEZ",
    email:          "lgomez@impsur.com",
    telefono:       "0981-456789",
    servicio:       "Módulo de ventas y gestión de clientes",
    valor_estimado: 12000000,
    etapa:          "GANADO",
    proxima_accion:       "Inicio de implementación",
    fecha_proxima_accion: "2026-03-15",
    creado_por:     "JUAN PÉREZ",
    responsable:    "JUAN PÉREZ",
    notas: [
      {
        id:    3,
        texto: "Contrato firmado. Inicio de implementación previsto para el 15/03.",
        fecha: "2026-03-09T11:00:00.000Z",
      },
    ],
    fecha_creacion:      "2026-02-01T08:00:00.000Z",
    fecha_actualizacion: "2026-03-09T11:00:00.000Z",
    cliente_creado: false,
  },
  {
    id: 5,
    numero_control: "CRM-000005",
    empresa:        "SERVICIOS GLOBALES",
    contacto:       "MIGUEL TORRES",
    email:          "mtorres@serviciosglobales.com",
    telefono:       "0961-567890",
    servicio:       "Módulo de reportes y analytics",
    valor_estimado: 8500000,
    etapa:          "CONTACTADO",
    proxima_accion:       "Demo del módulo de reportes",
    fecha_proxima_accion: "2026-03-13",
    creado_por:     "MARIA LOPEZ",
    responsable:    "CARLOS VEGA",
    notas: [],
    fecha_creacion:      "2026-03-09T10:00:00.000Z",
    fecha_actualizacion: "2026-03-09T10:00:00.000Z",
  },
];

// ─── Clave de localStorage ────────────────────────────────────────────────────

const KEY = "neura_crm";

// ─── Helpers internos ─────────────────────────────────────────────────────────

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

function generarNumeroControl(base: Prospecto[]): string {
  const maxNum = base.reduce((max, p) => {
    const match = p.numero_control?.match(/CRM-(\d+)/);
    if (match) return Math.max(max, parseInt(match[1]));
    return max;
  }, 0);
  return `CRM-${String(maxNum + 1).padStart(6, "0")}`;
}

/** Migra etapas obsoletas y devuelve la base actual (localStorage o mocks). */
function getBase(): Prospecto[] {
  const stored = safeGet<Prospecto[]>(KEY, []);
  if (stored.length === 0) {
    return PROSPECTOS_MOCK.map((p) => ({ ...p, notas: [...p.notas] }));
  }
  // Migrar etapa PROPUESTA → CONTACTADO si existiera en datos viejos
  return stored.map((p) => ({
    ...p,
    etapa: (p.etapa as string) === "PROPUESTA" ? "CONTACTADO" : p.etapa,
    notas: [...(p.notas ?? [])],
  })) as Prospecto[];
}

// ─── API pública ──────────────────────────────────────────────────────────────

export function getProspectos(): Prospecto[] {
  return getBase();
}

export function getProspecto(id: number): Prospecto | undefined {
  return getBase().find((p) => p.id === id);
}

export function saveProspecto(
  datos: Omit<Prospecto, "id" | "numero_control" | "notas" | "fecha_creacion" | "fecha_actualizacion">
): Prospecto {
  const base  = getBase();
  const nuevo: Prospecto = {
    id:                  Date.now(),
    numero_control:      generarNumeroControl(base),
    notas:               [],
    fecha_creacion:      new Date().toISOString(),
    fecha_actualizacion: new Date().toISOString(),
    ...datos,
  };
  safeSet(KEY, [...base, nuevo]);
  return nuevo;
}

export function updateProspecto(
  id: number,
  datos: Partial<Omit<Prospecto, "id" | "numero_control" | "fecha_creacion">>
): Prospecto | null {
  const base = getBase();
  const idx  = base.findIndex((p) => p.id === id);
  if (idx === -1) return null;

  const updated: Prospecto = {
    ...base[idx],
    ...datos,
    fecha_actualizacion: new Date().toISOString(),
  };
  base[idx] = updated;
  safeSet(KEY, base);
  return updated;
}

/** Mueve un prospecto a una nueva etapa. */
export function moveProspecto(id: number, etapa: EtapaFunnel): void {
  updateProspecto(id, { etapa });
}

/** Agrega una nota interna al prospecto. */
export function addNota(prospectoId: number, texto: string): Nota | null {
  const base = getBase();
  const idx  = base.findIndex((p) => p.id === prospectoId);
  if (idx === -1) return null;

  const nota: Nota = {
    id:    Date.now(),
    texto: texto.trim(),
    fecha: new Date().toISOString(),
  };

  base[idx] = {
    ...base[idx],
    notas:               [...(base[idx].notas ?? []), nota],
    fecha_actualizacion: new Date().toISOString(),
  };
  safeSet(KEY, base);
  return nota;
}

/** Elimina un prospecto por ID. */
export function deleteProspecto(id: number): void {
  const base = getBase().filter((p) => p.id !== id);
  safeSet(KEY, base);
}
