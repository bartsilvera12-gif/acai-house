/**
 * Logger seguro: envuelve los `console.*` con redacción de campos sensibles.
 *
 * Reglas de redacción:
 *   - Claves cuyo nombre contiene password/token/secret/key/authorization
 *     (case-insensitive) se reemplazan por "[REDACTED:N]" donde N es el
 *     largo original (útil para diagnosticar problemas sin filtrar valor).
 *   - Patrones tipo JWT (Bearer eyJ…) y otros tokens largos también se
 *     redactan dentro de strings.
 *   - Recursivo en objetos/arrays con profundidad máxima 6 (defensa contra
 *     ciclos y logs gigantes).
 *
 * NO reemplaza a los console.* existentes — es opt-in: importás
 * `safeLog` y lo usás cuando el log toca datos sensibles (auth,
 * webhooks, integraciones externas). Para forzar uso en todo el código
 * habría que cambiar la ESLint config con no-console + permitir solo
 * safeLog; fuera de scope ahora.
 */

const SENSITIVE_KEY_RE = /(password|token|secret|key|authorization|cookie|session|api[_-]?key|service[_-]?role)/i;
// Cualquier corrida larga de [A-Za-z0-9_-] de >=20 chars sospechosa de token.
const LONG_TOKEN_RE = /\b[A-Za-z0-9_\-]{32,}\b/g;
// JWTs: 3 partes base64 separadas por punto.
const JWT_RE = /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g;
const MAX_DEPTH = 6;

function redactString(s: string): string {
  return s
    .replace(JWT_RE, (m) => `[REDACTED:JWT:${m.length}]`)
    .replace(LONG_TOKEN_RE, (m) => `[REDACTED:${m.length}]`);
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return "[REDACTED:depth]";
  if (value == null) return value;
  const t = typeof value;
  if (t === "string") return redactString(value as string);
  if (t === "number" || t === "boolean" || t === "bigint") return value;
  if (t === "function") return "[Function]";
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, depth + 1));
  }
  if (t === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        if (typeof v === "string") {
          out[k] = `[REDACTED:${v.length}]`;
        } else {
          out[k] = "[REDACTED]";
        }
      } else {
        out[k] = redactValue(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

function redactArgs(args: unknown[]): unknown[] {
  return args.map((a) => redactValue(a, 0));
}

/** Wrapper sobre los métodos de console que pasa cada argumento por el redactor. */
export const safeLog = {
  log: (...args: unknown[]) => console.log(...redactArgs(args)),
  info: (...args: unknown[]) => console.info(...redactArgs(args)),
  warn: (...args: unknown[]) => console.warn(...redactArgs(args)),
  error: (...args: unknown[]) => console.error(...redactArgs(args)),
  /** Útil para tests / lib externa. */
  redact: (value: unknown) => redactValue(value, 0),
};

export type SafeLogger = typeof safeLog;
