/**
 * Rate limiter in-memory con sliding window por bucket (clave string).
 *
 * Limitaciones honestas:
 *   - In-memory: cada instancia del server tiene su propio contador. En un
 *     deploy multi-instancia (Coolify replicado, Vercel edge) cada réplica
 *     cuenta independiente → un atacante puede multiplicar el cap por N.
 *     Para una protección "real" multi-instancia mover a Redis/KV (helper
 *     queda con la misma firma).
 *   - Reinicio del proceso resetea los contadores.
 *
 * Suficiente para single-instance + protección de login y webhooks contra
 * abuso casual / probes / bots simples. Cuando rampee el tráfico, migrar.
 */

type Hit = { count: number; windowStart: number };

const buckets = new Map<string, Hit>();
const MAX_BUCKETS = 50_000; // protección de memoria; LRU lazy abajo
const SWEEP_EVERY = 1_000;
let sweepCounter = 0;

/**
 * Devuelve `true` si la request está permitida, `false` si debe rechazarse.
 *
 * @param key       Identificador del bucket (ej. `login:${ip}` o `wh:${ip}`).
 * @param max       Cantidad máxima de hits permitidos por ventana.
 * @param windowMs  Tamaño de la ventana en milisegundos.
 */
export function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const cur = buckets.get(key);

  if (!cur || now - cur.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    maybeSweep(now);
    return true;
  }

  if (cur.count >= max) return false;
  cur.count += 1;
  return true;
}

/** Cuenta cuántos hits restan en la ventana actual (para devolver en headers). */
export function rateLimitRemaining(key: string, max: number): number {
  const cur = buckets.get(key);
  if (!cur) return max;
  return Math.max(0, max - cur.count);
}

/** Calcula los segundos hasta que se resetea la ventana actual. */
export function rateLimitResetSeconds(key: string, windowMs: number): number {
  const cur = buckets.get(key);
  if (!cur) return 0;
  return Math.max(0, Math.ceil((cur.windowStart + windowMs - Date.now()) / 1000));
}

/**
 * Extrae la IP real del cliente respetando proxies (Coolify/Traefik/Vercel).
 * Si no se puede determinar, devuelve `unknown` para que el bucket no sea
 * universal (mejor un cap por "unknown" que no aplicar nada).
 */
export function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

/** Limpia entradas viejas para no crecer indefinidamente. */
function maybeSweep(now: number): void {
  sweepCounter += 1;
  if (sweepCounter < SWEEP_EVERY && buckets.size < MAX_BUCKETS) return;
  sweepCounter = 0;
  // Borrar buckets cuya ventana caducó hace más de 5 minutos.
  const cutoff = now - 5 * 60_000;
  for (const [k, v] of buckets) {
    if (v.windowStart < cutoff) buckets.delete(k);
  }
}
