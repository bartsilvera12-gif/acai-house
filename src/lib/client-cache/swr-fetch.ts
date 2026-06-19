"use client";

/**
 * Cache stale-while-revalidate en memoria por URL+key.
 *
 * Patrón:
 *   - Si hay valor FRESCO (< ttlMs) → lo devuelve sin pegarle a la red.
 *   - Si hay valor STALE → lo devuelve inmediato Y revalida en background.
 *   - Si no hay valor → fetchea y bloquea hasta tener respuesta.
 *
 * Dedupe en vuelo: si dos llamadas concurrentes piden la misma clave,
 * comparten la misma promesa (no se duplican requests).
 *
 * Pensado para listados que cambian con baja frecuencia (productos,
 * movimientos, ubicaciones). NO usar para datos transaccionales en vivo.
 */

type Entry<T> = { value: T; updatedAt: number };

const cache = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export function clearSwrCache(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    inflight.clear();
    return;
  }
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
  for (const k of inflight.keys()) if (k.startsWith(prefix)) inflight.delete(k);
}

/** Invalida una entrada concreta (forzar refetch en el próximo getter). */
export function invalidateSwr(key: string): void {
  cache.delete(key);
  inflight.delete(key);
}

/**
 * Devuelve `key` desde cache si existe y está fresco, o ejecuta `fetcher`.
 * Si hay valor stale, devuelve el stale y dispara revalidación en background.
 *
 * @param key      identificador único (típicamente la URL absoluta).
 * @param fetcher  función que produce el valor (la promesa real).
 * @param ttlMs    edad máxima para considerarlo fresco. Default 60s.
 */
export async function swrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = 60_000,
): Promise<T> {
  const now = Date.now();
  const cached = cache.get(key) as Entry<T> | undefined;

  if (cached && now - cached.updatedAt < ttlMs) {
    return cached.value;
  }

  if (cached) {
    // Stale: devolvemos lo viejo, revalidamos en background sin bloquear.
    if (!inflight.has(key)) {
      const p = fetcher()
        .then((v) => {
          cache.set(key, { value: v, updatedAt: Date.now() });
          return v;
        })
        .catch(() => cached.value) // si falla la revalidación, dejamos el stale
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return cached.value;
  }

  // Sin cache: dedupe en vuelo.
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const p = fetcher()
    .then((v) => {
      cache.set(key, { value: v, updatedAt: Date.now() });
      return v;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
