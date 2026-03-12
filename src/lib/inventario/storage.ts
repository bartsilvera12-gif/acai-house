import type {
  Producto,
  MovimientoInventario,
  MetodoValuacion,
  TipoMovimiento,
} from "./types";

// ─── Datos de ejemplo ────────────────────────────────────────────────────────

export const PRODUCTOS_MOCK: Producto[] = [
  {
    id: 1,
    nombre: "Remera Oversize Blanca",
    sku: "OOTD-001",
    costo_promedio: 35000,
    precio_venta: 75000,
    stock_actual: 45,
    stock_minimo: 10,
    unidad_medida: "Unidad",
    metodo_valuacion: "CPP" as MetodoValuacion,
  },
  {
    id: 2,
    nombre: "Polo Negra Premium",
    sku: "OOTD-002",
    costo_promedio: 48000,
    precio_venta: 110000,
    stock_actual: 18,
    stock_minimo: 5,
    unidad_medida: "Unidad",
    metodo_valuacion: "FIFO" as MetodoValuacion,
  },
  {
    id: 3,
    nombre: "Canguro Gris Unisex",
    sku: "OOTD-003",
    costo_promedio: 90000,
    precio_venta: 165000,
    stock_actual: 12,
    stock_minimo: 8,
    unidad_medida: "Unidad",
    metodo_valuacion: "LIFO" as MetodoValuacion,
  },
  {
    id: 4,
    nombre: "Bermuda Cargo Beige",
    sku: "OOTD-004",
    costo_promedio: 55000,
    precio_venta: 120000,
    stock_actual: 6,
    stock_minimo: 10,
    unidad_medida: "Unidad",
    metodo_valuacion: "CPP" as MetodoValuacion,
  },
];

export const MOVIMIENTOS_MOCK: MovimientoInventario[] = [
  {
    id: 1,
    producto_id: 1,
    producto_nombre: "Remera Oversize Blanca",
    producto_sku: "OOTD-001",
    tipo: "ENTRADA",
    cantidad: 50,
    costo_unitario: 35000,
    origen: "compra",
    fecha: "2026-03-01T10:00:00.000Z",
  },
  {
    id: 2,
    producto_id: 2,
    producto_nombre: "Polo Negra Premium",
    producto_sku: "OOTD-002",
    tipo: "SALIDA",
    cantidad: 5,
    costo_unitario: 48000,
    origen: "venta",
    fecha: "2026-03-03T14:30:00.000Z",
  },
  {
    id: 3,
    producto_id: 3,
    producto_nombre: "Canguro Gris Unisex",
    producto_sku: "OOTD-003",
    tipo: "SALIDA",
    cantidad: 8,
    costo_unitario: 90000,
    origen: "venta",
    fecha: "2026-03-04T11:00:00.000Z",
  },
  {
    id: 4,
    producto_id: 4,
    producto_nombre: "Bermuda Cargo Beige",
    producto_sku: "OOTD-004",
    tipo: "AJUSTE",
    cantidad: -2,
    costo_unitario: 55000,
    origen: "ajuste_manual",
    fecha: "2026-03-05T09:15:00.000Z",
  },
];

// ─── Claves de localStorage ───────────────────────────────────────────────────

const KEY_PRODUCTOS = "neura_productos";
const KEY_STOCK_OVERRIDES = "neura_stock_overrides";
const KEY_PRECIO_OVERRIDES = "neura_precio_overrides";
const KEY_MOVIMIENTOS = "neura_movimientos";

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
    // localStorage no disponible (SSR o bloqueado)
  }
}

// ─── Productos ────────────────────────────────────────────────────────────────

/**
 * Devuelve todos los productos (mocks + guardados), con el stock_actual
 * ajustado según los overrides generados por movimientos.
 */
type PrecioOverride = { precio_venta?: number; costo_promedio?: number };

export function getProductos(): Producto[] {
  const custom = safeGet<Producto[]>(KEY_PRODUCTOS, []);
  const stockOverrides = safeGet<Record<number, number>>(KEY_STOCK_OVERRIDES, {});
  const precioOverrides = safeGet<Record<number, PrecioOverride>>(KEY_PRECIO_OVERRIDES, {});
  const todos = [...PRODUCTOS_MOCK, ...custom];
  return todos.map((p) => {
    const po = precioOverrides[p.id];
    return {
      ...p,
      stock_actual:
        stockOverrides[p.id] !== undefined ? stockOverrides[p.id] : p.stock_actual,
      precio_venta: po?.precio_venta ?? p.precio_venta,
      costo_promedio: po?.costo_promedio ?? p.costo_promedio,
    };
  });
}

/**
 * Actualiza precio_venta y/o costo_promedio de un producto en localStorage.
 * Compatible con mocks y productos custom (usa el mismo sistema de overrides).
 */
export function updateProductoPrecios(
  productoId: number,
  datos: { precio_venta?: number; costo_promedio?: number }
): void {
  const overrides = safeGet<Record<number, PrecioOverride>>(KEY_PRECIO_OVERRIDES, {});
  overrides[productoId] = { ...overrides[productoId], ...datos };
  safeSet(KEY_PRECIO_OVERRIDES, overrides);
}

/**
 * Comprueba si ya existe un producto con el mismo SKU (obligatorio)
 * o el mismo nombre (case-insensitive). Devuelve el producto encontrado o null.
 */
export function productoExiste(sku: string, nombre: string): Producto | null {
  const todos = getProductos();
  return (
    todos.find(
      (p) =>
        p.sku.toLowerCase() === sku.toLowerCase() ||
        p.nombre.toLowerCase() === nombre.toLowerCase()
    ) ?? null
  );
}

/**
 * Guarda un producto nuevo y, si tiene stock_actual > 0,
 * genera automáticamente un movimiento ENTRADA de inventario_inicial.
 */
export function saveProducto(datos: Omit<Producto, "id">): Producto {
  const nuevo: Producto = { id: Date.now(), ...datos };
  const existentes = safeGet<Producto[]>(KEY_PRODUCTOS, []);
  safeSet(KEY_PRODUCTOS, [...existentes, nuevo]);

  if (nuevo.stock_actual > 0) {
    saveMovimiento({
      producto_id: nuevo.id,
      producto_nombre: nuevo.nombre,
      producto_sku: nuevo.sku,
      tipo: "ENTRADA",
      cantidad: nuevo.stock_actual,
      costo_unitario: nuevo.costo_promedio,
      origen: "inventario_inicial",
      fecha: new Date().toISOString(),
    });
  }

  return nuevo;
}

// ─── Movimientos ──────────────────────────────────────────────────────────────

/** Devuelve movimientos guardados; usa mocks si aún no hay datos reales. */
export function getMovimientos(): MovimientoInventario[] {
  const stored = safeGet<MovimientoInventario[]>(KEY_MOVIMIENTOS, []);
  return stored.length === 0 ? MOVIMIENTOS_MOCK : stored;
}

/**
 * Guarda un nuevo movimiento y actualiza el stock_actual del producto afectado.
 *
 * Reglas de impacto en stock:
 *   ENTRADA → stock + |cantidad|
 *   SALIDA  → stock - |cantidad|  (mínimo 0)
 *   AJUSTE  → stock + cantidad    (puede ser negativo para disminuir)
 */
export function saveMovimiento(
  mov: Omit<MovimientoInventario, "id">
): void {
  // 1. Persiste el movimiento
  const existentes = safeGet<MovimientoInventario[]>(KEY_MOVIMIENTOS, []);
  const base =
    existentes.length === 0 ? [...MOVIMIENTOS_MOCK] : existentes;
  const nuevo: MovimientoInventario = { id: Date.now(), ...mov };
  safeSet(KEY_MOVIMIENTOS, [...base, nuevo]);

  // 2. Calcula el delta de stock según el tipo
  const delta = calcularDelta(mov.tipo, mov.cantidad);

  // 3. Obtiene el stock actual del producto (con overrides ya aplicados)
  const productos = getProductos();
  const producto = productos.find((p) => p.id === mov.producto_id);
  if (!producto) return;

  const nuevoStock = Math.max(0, producto.stock_actual + delta);

  // 4. Persiste el override de stock
  const overrides = safeGet<Record<number, number>>(
    KEY_STOCK_OVERRIDES,
    {}
  );
  overrides[mov.producto_id] = nuevoStock;
  safeSet(KEY_STOCK_OVERRIDES, overrides);
}

function calcularDelta(tipo: TipoMovimiento, cantidad: number): number {
  if (tipo === "ENTRADA") return Math.abs(cantidad);
  if (tipo === "SALIDA") return -Math.abs(cantidad);
  return cantidad; // AJUSTE: la cantidad ya lleva el signo
}
