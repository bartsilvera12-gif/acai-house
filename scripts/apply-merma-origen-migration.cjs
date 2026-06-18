/**
 * Aplica la migración que habilita origen='merma' en movimientos_inventario,
 * sobre el schema activo (NEURA_CLIENT_SCHEMA, default 'acaihouse').
 *
 * Uso: node scripts/apply-merma-origen-migration.cjs
 * Lee SUPABASE_DB_URL de .env.local
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env.local") });
const pg = require("pg");

const SCHEMA = (process.env.NEURA_CLIENT_SCHEMA || "acaihouse").trim();
const FILE = path.resolve(process.cwd(), "supabase/migrations/20260618140000_movimientos_origen_merma.sql");

if (!/^[a-z0-9_]+$/.test(SCHEMA)) { console.error("Schema inválido:", SCHEMA); process.exit(2); }
const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) { console.error("Falta SUPABASE_DB_URL en .env.local"); process.exit(2); }

async function main() {
  const sql = fs.readFileSync(FILE, "utf8");
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query(`SET LOCAL search_path = "${SCHEMA}"`);
    await c.query(sql);
    await c.query("COMMIT");
    const def = (await c.query(
      `select pg_get_constraintdef(co.oid) def
       from pg_constraint co join pg_class cl on cl.oid=co.conrelid
       join pg_namespace nn on nn.oid=cl.relnamespace
       where nn.nspname=$1 and cl.relname='movimientos_inventario'
         and co.conname='movimientos_inventario_origen_check'`, [SCHEMA])).rows[0]?.def;
    console.log(`✅ Migración aplicada en schema '${SCHEMA}'.`);
    console.log("   CHECK origen =>", def);
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("❌ Error:", e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}
main();
