# Açaí House — Plan de pruebas funcionales de Fase 1

Última actualización: 2026-11-20
Alcance: validar simplificación de productos, presentaciones por tamaño, adicionales y su persistencia inequívoca por línea de venta.
**Prerrequisito**: ambas migraciones aplicadas sobre el schema `acaihouse`, en este orden:

1. `supabase/acaihouse/migrations/20261120120000_productos_presentaciones_adicionales.sql`
2. `supabase/acaihouse/migrations/20261120130000_ventas_items_presentacion_y_adicionales.sql`

Ambiente: usar un empresa_id de Açaí House, usuario de caja con permiso de ventas, y una caja abierta.

---

## 0. Smoke de base de datos (antes de tocar la UI)

Ejecutar en Supabase SQL editor conectado al proyecto de Açaí House:

```sql
-- 0.1 Objetos creados
SELECT to_regclass('acaihouse.producto_presentaciones')          IS NOT NULL AS tabla_presentaciones,
       to_regclass('acaihouse.adicionales')                      IS NOT NULL AS tabla_adicionales,
       to_regclass('acaihouse.producto_adicionales_permitidos')  IS NOT NULL AS tabla_adic_permitidos,
       to_regclass('acaihouse.venta_item_adicionales')           IS NOT NULL AS tabla_vi_adic;

-- 0.2 Columna nueva en ventas_items
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'acaihouse'
  AND table_name   = 'ventas_items'
  AND column_name  = 'presentacion_id';

-- 0.3 RLS activa en cada tabla nueva
SELECT c.relname, c.relrowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'acaihouse'
  AND c.relname IN ('producto_presentaciones','adicionales',
                    'producto_adicionales_permitidos','venta_item_adicionales');

-- 0.4 4 policies por tabla
SELECT tablename, COUNT(*) AS policies
FROM pg_policies
WHERE schemaname = 'acaihouse'
  AND tablename IN ('producto_presentaciones','adicionales',
                    'producto_adicionales_permitidos','venta_item_adicionales')
GROUP BY tablename;

-- 0.5 Seed de categorías (deben aparecer las 3 para cada empresa)
SELECT empresa_id, nombre
FROM acaihouse.categorias_productos
WHERE nombre IN ('CARTA / AÇAÍ', 'MATERIAS PRIMAS', 'BEBIDAS')
ORDER BY empresa_id, nombre;

-- 0.6 Seed de 5 adicionales
SELECT empresa_id, nombre, precio
FROM acaihouse.adicionales
WHERE nombre IN ('Leche en polvo','Leche condensada','Granola','Chocolate','Rocklets')
ORDER BY empresa_id, orden;
```

Esperado: todas las tablas creadas, RLS ON en las 4, 4 policies cada una, 3 categorías y 5 adicionales por empresa.

---

## 1. Caso: venta de un producto SIN presentaciones

Setup:
- Crear producto "Agua mineral 500ml", categoría BEBIDAS, precio 8.000, sin presentaciones ni adicionales permitidos.

Pasos:
1. Caja → nueva venta → agregar "Agua mineral 500ml" → cantidad 1 → confirmar venta efectivo.

Verificar:
- `ventas` creada, 1 fila.
- `ventas_items` 1 fila, `presentacion_id` = NULL, `precio_venta` = 8.000.
- `venta_item_adicionales` sin filas para esa venta.
- Total = 8.000.
- `movimientos_inventario` SALIDA si el producto controla stock, o sin fila si es de Menú.

```sql
SELECT vi.producto_nombre, vi.cantidad, vi.precio_venta, vi.presentacion_id,
       (SELECT count(*) FROM acaihouse.venta_item_adicionales WHERE venta_item_id = vi.id) AS adicionales_count
FROM acaihouse.ventas_items vi
JOIN acaihouse.ventas v ON v.id = vi.venta_id
WHERE v.numero_control = '<VTA-XXXXXX>';
```

---

## 2. Caso: Venta Açaí Tradicional Chico

Setup:
- Crear producto "Açaí Tradicional", categoría CARTA / AÇAÍ, precio 14.000 (sólo como fallback), tipo Menú.
- Presentaciones:
  - Chico: 14.000
  - Mediano: 17.000
  - Grande: 22.000

Pasos:
1. Caja → agregar "Açaí Tradicional" → el selector muestra 3 tamaños.
2. Elegir "Chico" → el precio pasa a 14.000.
3. NO seleccionar adicionales.
4. Confirmar venta.

Verificar:
- `ventas_items.precio_venta` = 14.000.
- `ventas_items.presentacion_id` = id de la presentación "Chico".
- `ventas_items.producto_nombre` contiene "Chico" (se concatena en UI, pero el id es la fuente de verdad).
- `venta_item_adicionales` vacío.

```sql
SELECT vi.producto_nombre, vi.precio_venta, pp.nombre AS tamano
FROM acaihouse.ventas_items vi
LEFT JOIN acaihouse.producto_presentaciones pp ON pp.id = vi.presentacion_id
WHERE vi.venta_id = (SELECT id FROM acaihouse.ventas WHERE numero_control = '<VTA-XXXXXX>');
-- Esperado: tamano = 'Chico', precio_venta = 14000
```

---

## 3. Caso: Venta Açaí Tradicional Grande

Pasos:
1. Caja → agregar "Açaí Tradicional" → elegir "Grande".
2. Precio base pasa a 22.000.
3. Confirmar.

Verificar:
- `presentacion_id` = id de "Grande".
- `precio_venta` = 22.000.

---

## 4. Caso: Venta con uno o varios adicionales

Pasos:
1. Agregar "Açaí Tradicional" → Mediano (17.000) → marcar "Granola" (2.000) y "Chocolate" (4.000).
2. Preview del picker: Total línea = 17.000 + 2.000 + 4.000 = 23.000 × 1 = 23.000.
3. Confirmar.

Verificar:
- `ventas_items.precio_venta` = 23.000.
- `venta_item_adicionales` dos filas, una por adicional, con `adicional_nombre` y `precio_unitario` desde catálogo (no desde cliente).

```sql
SELECT vi.precio_venta,
       pp.nombre AS tamano,
       (SELECT json_agg(json_build_object('nombre', a.adicional_nombre, 'precio', a.precio_unitario))
        FROM acaihouse.venta_item_adicionales a
        WHERE a.venta_item_id = vi.id) AS adicionales
FROM acaihouse.ventas_items vi
LEFT JOIN acaihouse.producto_presentaciones pp ON pp.id = vi.presentacion_id
WHERE vi.venta_id = (SELECT id FROM acaihouse.ventas WHERE numero_control = '<VTA-XXXXXX>');
```

---

## 5. Caso: Cantidad > 1 con adicionales

Pasos:
1. Agregar "Açaí Tradicional" → Chico (14.000) → marcar "Leche condensada" (2.000) → cantidad 3.
2. Total línea esperado = (14.000 + 2.000) × 3 = 48.000.

Verificar:
- `ventas_items.cantidad` = 3; `precio_venta` = 16.000 (unitario); `total_linea` = 48.000.
- `venta_item_adicionales` 1 fila con `cantidad = 1` (el adicional aplica al unitario, no se multiplica por línea en Fase 1). Nota: la relación entre cantidad del item y cantidad del adicional la resolveremos en Fase 2 al modelar consumo de insumos.

---

## 6. Caso: Adicional no permitido

Setup (vía API o desde la UI de edición del producto):
- Editar "Açaí Tradicional" → "Adicionales permitidos" → marcar **sólo** `Granola`, `Chocolate`, `Rocklets` (dejar fuera Leche en polvo y Leche condensada).

### 6.a — UI respeta la restricción
Abrir Caja → agregar "Açaí Tradicional" → verificar que los chips SÓLO muestran los 3 permitidos.

### 6.b — Backend rechaza si se intenta saltar la UI
Enviar POST manual a `/api/ventas/create` con un ítem que incluya `adicional_id` de "Leche condensada" para "Açaí Tradicional":

Esperado: `400 Bad Request` con mensaje `El adicional "Leche condensada" no está permitido para este producto.`
No se creó ninguna fila en `ventas`, `ventas_items` ni `venta_item_adicionales`.

---

## 7. Caso: errores simulados durante el guardado

Objetivo: verificar que un fallo deja la DB consistente (sin huérfanos).

### 7.a — Fallo simulado en adicionales
Estado DB antes: `SELECT count(*) FROM acaihouse.ventas;` → anotar N.

Forzar fallo:
- Opción 1 (SQL temporal): revocar en una transacción manual el INSERT sobre `venta_item_adicionales` para la empresa (REVOKE INSERT ON acaihouse.venta_item_adicionales FROM authenticated;) y reproducir una venta con adicionales desde la UI. Restaurar el GRANT al terminar.
- Opción 2 (modo dev): temporalmente editar `create-venta-pg.ts` para inyectar `throw new Error("simulado")` dentro del bloque `adicionalesRows.length > 0`.

Reproducir una venta con adicionales. El request debe fallar con error visible al cajero.

Verificar:
```sql
-- N debe ser igual al valor anotado antes.
SELECT count(*) FROM acaihouse.ventas;
-- 0 filas:
SELECT * FROM acaihouse.ventas_items WHERE venta_id NOT IN (SELECT id FROM acaihouse.ventas);
SELECT * FROM acaihouse.venta_item_adicionales
WHERE venta_item_id NOT IN (SELECT id FROM acaihouse.ventas_items);
-- No se creó CxC huérfana ni movimiento huérfano:
SELECT count(*) FROM acaihouse.cuentas_por_cobrar WHERE venta_id NOT IN (SELECT id FROM acaihouse.ventas);
SELECT count(*) FROM acaihouse.movimientos_inventario WHERE venta_id IS NOT NULL
  AND venta_id NOT IN (SELECT id FROM acaihouse.ventas);
```

Todas deben devolver 0. Si alguna fila queda huérfana, falló el rollback por compensación.

### 7.b — Precio inflado
Enviar POST manual a `/api/ventas/create` con un ítem de "Açaí Tradicional Grande" pero `precio_venta: 999999`.

Esperado: `400` con `El precio de la línea 1 supera el tope de catálogo`.

### 7.c — Presentación de otro producto
Enviar POST con `producto_id` de "Agua mineral" y `presentacion_id` de "Grande" (que pertenece a Açaí Tradicional).

Esperado: `400` con `La presentación "Grande" no pertenece al producto de la línea 1`.

### 7.d — Presentación inactiva
Marcar `activo=false` en una presentación → intentar venderla.

Esperado: `400` con `La presentación "..." está inactiva`.

---

## 8. Caso: Edición de productos y presentaciones

### 8.a — Agregar presentaciones a un producto que no tenía
1. Editar "Agua mineral 500ml" → agregar presentaciones "Chico 300ml" 6.000 / "Grande 1L" 13.000.
2. Guardar.
3. Caja → agregar "Agua mineral 500ml" → debe aparecer selector con las 2 presentaciones.

### 8.b — Editar precio de una presentación existente
1. Editar "Açaí Tradicional" → cambiar "Grande" de 22.000 a 25.000.
2. Guardar.
3. Caja → vender un Grande → `precio_venta` = 25.000.

### 8.c — Borrar una presentación
1. Editar "Açaí Tradicional" → quitar "Chico" → guardar.
2. Caja → sólo se ven Mediano y Grande.
3. Ventas antiguas con `presentacion_id` de "Chico" quedan intactas (FK `ON DELETE SET NULL`):
```sql
SELECT count(*) FROM acaihouse.ventas_items WHERE presentacion_id IS NULL
  AND producto_nombre ILIKE '%Chico%'; -- las históricas conservan el nombre en producto_nombre
```

### 8.d — Protección anti-wipe (nueva en esta iteración)
1. Abrir editar producto, desconectar temporalmente la red justo cuando la página pide `/api/productos/:id/presentaciones` (DevTools → offline).
2. La página debe mostrar banner ambar "No pudimos cargar las presentaciones actuales... los cambios acá **no se guardarán**".
3. Si la operaria presiona Guardar, las presentaciones existentes **NO deben borrarse**.
4. Reconectar + recargar → la lista real aparece.

### 8.e — Restricción de adicionales permitidos
1. Editar "Açaí Tradicional" → en la sección "Adicionales permitidos" marcar sólo "Granola" y "Chocolate".
2. Guardar.
3. Caja → agregar "Açaí Tradicional" → los chips deben mostrar sólo Granola y Chocolate (no Leche en polvo, Leche condensada ni Rocklets).
4. Volver a editar → desmarcar todos → guardar → caja muestra todos otra vez (modo permisivo).

---

## 9. Regresiones en ventas tradicionales

Vender 3 productos SIN presentación y SIN adicionales (los que ya existían en Açaí House antes de Fase 1). Confirmar:

- Mismo flujo que antes: nada se rompe.
- `ventas_items.presentacion_id` = NULL en todas.
- `venta_item_adicionales` vacío.
- `movimientos_inventario` y `cuentas_por_cobrar` se crean como siempre.
- Descuento manual de precio en caja (bajar el precio por rebaja) **sigue aceptándose** — la validación de techo no bloquea precios por debajo del catálogo.

---

## 10. Smoke de seguridad (RLS + GRANTs)

Desde Supabase SQL con rol `anon` (reset role):
```sql
SET ROLE anon;
-- Esperado: error "permission denied" (anon no tiene DML, y la policy denegaría empresa_id ajeno).
INSERT INTO acaihouse.adicionales (empresa_id, nombre, precio)
VALUES ('<cualquier uuid>', 'TEST ANON', 1);
RESET ROLE;
```

Con rol `authenticated` (sin JWT válido): `puede_acceder_empresa` devolverá false → el `INSERT` será rechazado silenciosamente (0 filas) o `permission denied` según policy.

Con `service_role` (vía la API del backend): sigue funcionando porque Supabase hace bypass de RLS.

---

## Resumen de criterios de aceptación

- [ ] Smoke DB (0.x) todo verde.
- [ ] Casos 1–5 producen filas con `precio_venta`, `presentacion_id` y `venta_item_adicionales` consistentes.
- [ ] Caso 6 bloquea un adicional no permitido a nivel UI y backend.
- [ ] Caso 7.a: después del fallo, ninguna fila huérfana (ventas, items, adicionales, CxC, movimientos).
- [ ] Casos 7.b/7.c/7.d rechazan con los mensajes esperados.
- [ ] Caso 8.d: banner ambar impide wipe accidental.
- [ ] Caso 9: ventas tradicionales sin cambios observables.
- [ ] Caso 10: `anon` no puede escribir; `authenticated` sólo ve rows de su empresa.
