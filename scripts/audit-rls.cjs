#!/usr/bin/env node
/**
 * Auditoría de RLS del schema activo (NEURA_CLIENT_SCHEMA, default 'acaihouse').
 *
 * Falla con exit 1 si encuentra:
 *   - Tablas sin RLS habilitado.
 *   - Tablas con RLS pero sin políticas (lo que en la práctica niega todo,
 *     pero suele indicar un olvido al portar el módulo).
 *
 * Pensado para correr en CI/precommit: `npm run db:audit-rls`.
 * Lee SUPABASE_DB_URL de .env.local.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env.local") });
const pg = require("pg");

const SCHEMA = (process.env.NEURA_CLIENT_SCHEMA || "acaihouse").trim();

// Tablas que conviene saltearnos del audit (catálogo central, vistas
// materializadas, etc.). Mantener vacío salvo casos justificados.
const SKIP = new Set(/* p.ej. "vistas_publicas_marketing" */);

if (!/^[a-z0-9_]+$/.test(SCHEMA)) {
  console.error("Schema inválido:", SCHEMA);
  process.exit(2);
}
const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) {
  console.error("Falta SUPABASE_DB_URL en .env.local");
  process.exit(2);
}

async function main() {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    // Tablas (no vistas, no particiones) del schema, con flag rls
    const tablesRes = await c.query(
      `select c.relname tablename, c.relrowsecurity rls_enabled
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = $1 and c.relkind = 'r'
        order by c.relname`,
      [SCHEMA],
    );

    // Conteo de policies por tabla
    const polsRes = await c.query(
      `select tablename, count(*)::int n
         from pg_policies
        where schemaname = $1
        group by tablename`,
      [SCHEMA],
    );
    const polCount = new Map(polsRes.rows.map((r) => [r.tablename, r.n]));

    const noRls = [];
    const noPolicies = [];
    const ok = [];

    for (const row of tablesRes.rows) {
      if (SKIP.has(row.tablename)) continue;
      const policies = polCount.get(row.tablename) ?? 0;
      if (!row.rls_enabled) noRls.push(row.tablename);
      else if (policies === 0) noPolicies.push(row.tablename);
      else ok.push({ name: row.tablename, policies });
    }

    console.log(`\nAuditoría RLS · schema "${SCHEMA}"`);
    console.log("─".repeat(60));
    console.log(`Tablas totales: ${tablesRes.rows.length}`);
    console.log(`  · con RLS + policies: ${ok.length}`);
    console.log(`  · con RLS sin policies: ${noPolicies.length}`);
    console.log(`  · sin RLS: ${noRls.length}`);

    if (noRls.length) {
      console.log("\n❌ TABLAS SIN RLS HABILITADO:");
      noRls.forEach((t) => console.log(`   - ${t}`));
    }
    if (noPolicies.length) {
      console.log("\n⚠️  TABLAS CON RLS HABILITADO PERO SIN POLICIES:");
      console.log("   (efectivamente niegan todo; suele ser un olvido al portar el módulo)");
      noPolicies.forEach((t) => console.log(`   - ${t}`));
    }

    const failed = noRls.length > 0 || noPolicies.length > 0;
    if (failed) {
      console.log("\n→ Falló la auditoría. Reparar antes de hacer push.\n");
      process.exitCode = 1;
    } else {
      console.log("\n✅ Auditoría OK: todas las tablas tienen RLS + policies.\n");
    }
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
