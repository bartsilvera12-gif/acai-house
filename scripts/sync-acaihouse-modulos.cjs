/**
 * Sincroniza módulos de `acaihouse` para que tenga los mismos que `reservacaacupe`
 * + el módulo de Caja (ventas) que vive en `enlodemari`.
 *
 * Uso:
 *   node scripts/sync-acaihouse-modulos.cjs           # solo inspección + dry-run
 *   node scripts/sync-acaihouse-modulos.cjs --apply   # aplica dentro de una transacción
 *
 * Credencial: lee SUPABASE_DB_URL del entorno (NO se commitea).
 */
const pg = require("pg");

const URL = process.env.SUPABASE_DB_URL?.trim();
if (!URL) { console.error("Falta SUPABASE_DB_URL en el entorno"); process.exit(2); }

const APPLY = process.argv.includes("--apply");
const EXACT = process.argv.includes("--exact");
const SCHEMAS = ["reservacaacupe", "enlodemari", "acaihouse"];

// Slugs que NUNCA se desactivan aunque reservacaacupe no los tenga activos.
// La caja (ventas) y el reporte de caja (reportes) ya están alineados en ambos
// schemas; este KEEP queda como red de seguridad explícita.
const KEEP_ACTIVE = new Set(["ventas", "reportes"]);

async function listModulos(c, sch) {
  const q = `
    SELECT m.slug, m.nombre, m.id AS modulo_id
    FROM ${sch}.modulos m
    ORDER BY m.slug
  `;
  const r = await c.query(q);
  return r.rows;
}

async function listEmpresas(c, sch) {
  // Detecta dinámicamente una columna "label" razonable (nombre, razon_social, etc.)
  const cols = await c.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema=$1 AND table_name='empresas'`,
    [sch]
  );
  const names = new Set(cols.rows.map(r => r.column_name));
  const labelCol = ["nombre","razon_social","nombre_comercial","display_name","slug"].find(c => names.has(c)) ?? "id";
  const r = await c.query(`SELECT id, ${labelCol} AS label FROM ${sch}.empresas ORDER BY ${labelCol}`);
  return r.rows.map(x => ({ id: x.id, nombre: x.label }));
}

async function listEmpresaModulos(c, sch, empresaId) {
  const r = await c.query(`
    SELECT m.slug, em.activo
    FROM ${sch}.empresa_modulos em
    JOIN ${sch}.modulos m ON m.id = em.modulo_id
    WHERE em.empresa_id = $1
  `, [empresaId]);
  const map = new Map();
  for (const row of r.rows) map.set(row.slug, row.activo);
  return map;
}

function pad(s, n) { s = String(s ?? ""); return s.length >= n ? s : s + " ".repeat(n - s.length); }

async function main() {
  const c = new pg.Client({ connectionString: URL });
  await c.connect();
  try {
    console.log(`Modo: ${APPLY ? "APPLY (transacción)" : "INSPECCIÓN / dry-run"}\n`);

    // 1) Catálogo de módulos por schema
    const catalogos = {};
    for (const sch of SCHEMAS) catalogos[sch] = await listModulos(c, sch);

    // 2) Una empresa por schema (mono-cliente)
    const empresas = {};
    for (const sch of SCHEMAS) {
      const arr = await listEmpresas(c, sch);
      if (arr.length === 0) { console.error(`✖ ${sch} sin empresas`); process.exit(1); }
      if (arr.length > 1) {
        console.log(`⚠ ${sch} tiene ${arr.length} empresas — uso la primera por orden alfabético:`);
        for (const e of arr) console.log(`   · ${e.id}  ${e.nombre}`);
      }
      empresas[sch] = arr[0];
      console.log(`· ${pad(sch, 16)} empresa = ${empresas[sch].nombre} (${empresas[sch].id})`);
    }
    console.log();

    // 3) empresa_modulos por schema
    const estados = {};
    for (const sch of SCHEMAS) {
      estados[sch] = await listEmpresaModulos(c, sch, empresas[sch].id);
    }

    // 4) Universo de slugs (unión de los 3 catálogos)
    const allSlugs = new Set();
    for (const sch of SCHEMAS) for (const m of catalogos[sch]) allSlugs.add(m.slug);

    // 5) Tabla comparativa
    const W = 28;
    const STATE = (m) => m === undefined ? "—       " : (m ? "✓ activo" : "✗ inact ");
    console.log(`${pad("modulo_slug", W)}${pad("reservacaacupe", 18)}${pad("enlodemari", 14)}${pad("acaihouse", 14)}acción`);
    console.log("-".repeat(W + 18 + 14 + 14 + 30));

    const acciones = []; // {slug, action: 'insert' | 'activate'}
    const acaihouseCatalog = new Map(catalogos.acaihouse.map(m => [m.slug, m.modulo_id]));

    for (const slug of [...allSlugs].sort()) {
      const r = estados.reservacaacupe.get(slug);
      const e = estados.enlodemari.get(slug);
      const a = estados.acaihouse.get(slug);
      const wantedFromReserva = r === true;
      const wantedFromCaja = slug === "ventas" && e === true;
      const wantedActive = wantedFromReserva || wantedFromCaja;

      let accion = "";
      if (wantedActive) {
        if (a === true) accion = "ok (ya activo)";
        else if (a === false) accion = "ACTIVAR (UPDATE activo=true)";
        else if (a === undefined) {
          if (acaihouseCatalog.has(slug)) accion = "INSERT empresa_modulos";
          else accion = "✖ slug no existe en catálogo acaihouse";
        }
      } else {
        if (a === true) {
          if (EXACT && !KEEP_ACTIVE.has(slug)) accion = "DESACTIVAR (UPDATE activo=false)";
          else accion = "(queda activo — no se toca)";
        } else {
          accion = "—";
        }
      }

      if (accion.startsWith("ACTIVAR")) acciones.push({ slug, type: "activate" });
      if (accion.startsWith("INSERT")) acciones.push({ slug, type: "insert" });
      if (accion.startsWith("DESACTIVAR")) acciones.push({ slug, type: "deactivate" });

      console.log(`${pad(slug, W)}${pad(STATE(r), 18)}${pad(STATE(e), 14)}${pad(STATE(a), 14)}${accion}`);
    }

    console.log();
    console.log(`Acciones a realizar: ${acciones.length}`);
    for (const a of acciones) console.log(`  · ${a.type.toUpperCase()}  ${a.slug}`);

    if (!APPLY) {
      console.log("\n(dry-run — pasá --apply para ejecutar)");
      return;
    }

    if (acciones.length === 0) {
      console.log("\nNada que aplicar.");
      return;
    }

    // 6) Apply en transacción
    const empresaAcai = empresas.acaihouse.id;
    await c.query("BEGIN");
    try {
      for (const a of acciones) {
        if (a.type === "insert") {
          const moduloId = acaihouseCatalog.get(a.slug);
          await c.query(
            `INSERT INTO acaihouse.empresa_modulos (empresa_id, modulo_id, activo)
             VALUES ($1, $2, true)
             ON CONFLICT (empresa_id, modulo_id) DO UPDATE SET activo = true`,
            [empresaAcai, moduloId]
          );
          console.log(`  ✓ INSERT ${a.slug}`);
        } else if (a.type === "activate") {
          await c.query(
            `UPDATE acaihouse.empresa_modulos em
             SET activo = true
             FROM acaihouse.modulos m
             WHERE em.modulo_id = m.id AND m.slug = $2 AND em.empresa_id = $1`,
            [empresaAcai, a.slug]
          );
          console.log(`  ✓ ACTIVATE ${a.slug}`);
        } else if (a.type === "deactivate") {
          await c.query(
            `UPDATE acaihouse.empresa_modulos em
             SET activo = false
             FROM acaihouse.modulos m
             WHERE em.modulo_id = m.id AND m.slug = $2 AND em.empresa_id = $1`,
            [empresaAcai, a.slug]
          );
          console.log(`  ✓ DEACTIVATE ${a.slug}`);
        }
      }
      await c.query("COMMIT");
      console.log("\n✅ COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      console.error("\n❌ ROLLBACK:", e.message);
      process.exitCode = 1;
    }
  } finally {
    await c.end();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
