/**
 * Clona el schema `reservacaacupe` -> `acaihouse` DENTRO de la misma base Postgres.
 * Estructura completa (tablas, defaults, checks, indices, PKs, FKs, RLS, policies,
 * triggers, funciones, grants) + TODOS los datos. Operacion atomica (una transaccion).
 *
 * Uso:
 *   node scripts/clone-schema-acaihouse.cjs            # clona (falla si acaihouse existe)
 *   node scripts/clone-schema-acaihouse.cjs --force    # DROP SCHEMA acaihouse CASCADE y reclona
 *
 * Lee SUPABASE_DB_URL de .env.local
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env.local") });
const pg = require("pg");

const SRC = "reservacaacupe";
const DST = "acaihouse";
const FORCE = process.argv.includes("--force");

const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) { console.error("Falta SUPABASE_DB_URL en .env.local"); process.exit(2); }

// Fases SQL. Cada una es un bloque PL/pgSQL que usa los catalogos del schema origen
// y reconstruye el objeto en el destino. La reescritura de identificadores usa
// limites de palabra (\m \M) para tocar solo el nombre del schema, nunca substrings.
const phases = [
  ["guard+create", `
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='${DST}') THEN
        ${FORCE ? `EXECUTE 'DROP SCHEMA ${DST} CASCADE'; RAISE NOTICE 'schema ${DST} dropped (--force)';`
                : `RAISE EXCEPTION 'schema ${DST} ya existe (usar --force para reemplazar)';`}
      END IF;
      EXECUTE 'CREATE SCHEMA ${DST}';
      RAISE NOTICE 'schema ${DST} created';
    END$$;`],

  ["schema grants", `
    DO $$
    DECLARE r record; n int:=0;
    BEGIN
      FOR r IN
        SELECT e.grantee gid, e.privilege_type priv
        FROM pg_namespace nn CROSS JOIN LATERAL aclexplode(nn.nspacl) e
        WHERE nn.nspname='${SRC}' AND nn.nspacl IS NOT NULL
      LOOP
        EXECUTE format('GRANT %s ON SCHEMA ${DST} TO %s', r.priv,
          CASE WHEN r.gid=0 THEN 'PUBLIC' ELSE quote_ident((SELECT rolname FROM pg_roles WHERE oid=r.gid)) END);
        n:=n+1;
      END LOOP;
      RAISE NOTICE 'schema grants: %', n;
    END$$;`],

  ["tables (LIKE INCLUDING ALL)", `
    DO $$
    DECLARE r record; n int:=0;
    BEGIN
      FOR r IN SELECT cl.relname FROM pg_class cl JOIN pg_namespace nn ON nn.oid=cl.relnamespace
               WHERE nn.nspname='${SRC}' AND cl.relkind='r' ORDER BY cl.relname
      LOOP
        EXECUTE format('CREATE TABLE ${DST}.%I (LIKE ${SRC}.%I INCLUDING ALL)', r.relname, r.relname);
        n:=n+1;
      END LOOP;
      RAISE NOTICE 'tables: %', n;
    END$$;`],

  ["table grants", `
    DO $$
    DECLARE r record; n int:=0;
    BEGIN
      FOR r IN
        SELECT cl.relname, e.grantee gid, e.privilege_type priv
        FROM pg_class cl JOIN pg_namespace nn ON nn.oid=cl.relnamespace
             CROSS JOIN LATERAL aclexplode(cl.relacl) e
        WHERE nn.nspname='${SRC}' AND cl.relkind='r' AND cl.relacl IS NOT NULL
      LOOP
        EXECUTE format('GRANT %s ON ${DST}.%I TO %s', r.priv, r.relname,
          CASE WHEN r.gid=0 THEN 'PUBLIC' ELSE quote_ident((SELECT rolname FROM pg_roles WHERE oid=r.gid)) END);
        n:=n+1;
      END LOOP;
      RAISE NOTICE 'table grants: %', n;
    END$$;`],

  ["data copy", `
    DO $$
    DECLARE r record; n int:=0;
    BEGIN
      -- A esta altura acaihouse no tiene FKs, triggers ni RLS (esas fases corren despues),
      -- asi que el INSERT..SELECT se copia sin ninguna validacion ni efecto colateral.
      FOR r IN SELECT cl.relname FROM pg_class cl JOIN pg_namespace nn ON nn.oid=cl.relnamespace
               WHERE nn.nspname='${SRC}' AND cl.relkind='r' ORDER BY cl.relname
      LOOP
        EXECUTE format('INSERT INTO ${DST}.%I SELECT * FROM ${SRC}.%I', r.relname, r.relname);
        n:=n+1;
      END LOOP;
      RAISE NOTICE 'tables copied: %', n;
    END$$;`],

  ["functions", `
    DO $$
    DECLARE r record; n int:=0;
    BEGIN
      PERFORM set_config('check_function_bodies','off', true);
      FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace nn ON nn.oid=p.pronamespace
               WHERE nn.nspname='${SRC}'
      LOOP
        EXECUTE regexp_replace(pg_get_functiondef(r.oid), '\\m${SRC}\\M', '${DST}', 'g');
        n:=n+1;
      END LOOP;
      RAISE NOTICE 'functions: %', n;
    END$$;`],

  ["foreign keys", `
    DO $$
    DECLARE r record; n int:=0;
    BEGIN
      FOR r IN
        SELECT cl.relname tbl, co.conname,
               regexp_replace(pg_get_constraintdef(co.oid), '\\m${SRC}\\M', '${DST}', 'g') def
        FROM pg_constraint co
        JOIN pg_class cl ON cl.oid=co.conrelid
        JOIN pg_namespace nn ON nn.oid=co.connamespace
        WHERE nn.nspname='${SRC}' AND co.contype='f'
      LOOP
        EXECUTE format('ALTER TABLE ${DST}.%I ADD CONSTRAINT %I %s', r.tbl, r.conname, r.def);
        n:=n+1;
      END LOOP;
      RAISE NOTICE 'fks: %', n;
    END$$;`],

  ["rls enable", `
    DO $$
    DECLARE r record; n int:=0;
    BEGIN
      FOR r IN SELECT cl.relname, cl.relforcerowsecurity forced
               FROM pg_class cl JOIN pg_namespace nn ON nn.oid=cl.relnamespace
               WHERE nn.nspname='${SRC}' AND cl.relkind='r' AND cl.relrowsecurity
      LOOP
        EXECUTE format('ALTER TABLE ${DST}.%I ENABLE ROW LEVEL SECURITY', r.relname);
        IF r.forced THEN EXECUTE format('ALTER TABLE ${DST}.%I FORCE ROW LEVEL SECURITY', r.relname); END IF;
        n:=n+1;
      END LOOP;
      RAISE NOTICE 'rls tables: %', n;
    END$$;`],

  ["policies", `
    DO $$
    DECLARE r record; n int:=0; v_roles text; v_using text; v_check text;
    BEGIN
      FOR r IN SELECT * FROM pg_policies WHERE schemaname='${SRC}'
      LOOP
        SELECT string_agg(CASE WHEN x='public' THEN 'PUBLIC' ELSE quote_ident(x) END, ', ')
          INTO v_roles FROM unnest(r.roles) x;
        v_using := CASE WHEN r.qual IS NULL THEN ''
                        ELSE ' USING ('||regexp_replace(r.qual,'\\m${SRC}\\M','${DST}','g')||')' END;
        v_check := CASE WHEN r.with_check IS NULL THEN ''
                        ELSE ' WITH CHECK ('||regexp_replace(r.with_check,'\\m${SRC}\\M','${DST}','g')||')' END;
        EXECUTE format('CREATE POLICY %I ON ${DST}.%I AS %s FOR %s TO %s%s%s',
          r.policyname, r.tablename, r.permissive, r.cmd, v_roles, v_using, v_check);
        n:=n+1;
      END LOOP;
      RAISE NOTICE 'policies: %', n;
    END$$;`],

  ["triggers", `
    DO $$
    DECLARE r record; n int:=0;
    BEGIN
      FOR r IN
        SELECT regexp_replace(pg_get_triggerdef(tg.oid), '\\m${SRC}\\M', '${DST}', 'g') def
        FROM pg_trigger tg JOIN pg_class cl ON cl.oid=tg.tgrelid
        JOIN pg_namespace nn ON nn.oid=cl.relnamespace
        WHERE nn.nspname='${SRC}' AND NOT tg.tgisinternal
      LOOP
        EXECUTE r.def;
        n:=n+1;
      END LOOP;
      RAISE NOTICE 'triggers: %', n;
    END$$;`],

  ["default privileges", `
    DO $$
    DECLARE r record; n int:=0; obj text;
    BEGIN
      FOR r IN
        SELECT d.defaclobjtype objtype, e.grantee gid, e.privilege_type priv, d.defaclrole ownerrole
        FROM pg_default_acl d JOIN pg_namespace nn ON nn.oid=d.defaclnamespace
             CROSS JOIN LATERAL aclexplode(d.defaclacl) e
        WHERE nn.nspname='${SRC}'
      LOOP
        obj := CASE r.objtype WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES'
                              WHEN 'f' THEN 'FUNCTIONS' WHEN 'T' THEN 'TYPES' END;
        IF obj IS NULL THEN CONTINUE; END IF;
        BEGIN
          EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA ${DST} GRANT %s ON %s TO %s',
            (SELECT rolname FROM pg_roles WHERE oid=r.ownerrole), r.priv, obj,
            CASE WHEN r.gid=0 THEN 'PUBLIC' ELSE quote_ident((SELECT rolname FROM pg_roles WHERE oid=r.gid)) END);
          n:=n+1;
        EXCEPTION WHEN insufficient_privilege OR OTHERS THEN
          RAISE NOTICE 'skip default priv (owner=%): %', (SELECT rolname FROM pg_roles WHERE oid=r.ownerrole), SQLERRM;
        END;
      END LOOP;
      RAISE NOTICE 'default privs aplicadas: %', n;
    END$$;`],
];

async function main() {
  const c = new pg.Client({ connectionString: url });
  c.on("notice", (m) => console.log("  ·", m.message));
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL statement_timeout = 0");
    await c.query("SET LOCAL lock_timeout = '60s'");
    for (const [name, sql] of phases) {
      process.stdout.write(`▶ ${name} ... `);
      await c.query(sql);
      console.log("ok");
    }
    await c.query("COMMIT");
    console.log("\n✅ COMMIT — schema acaihouse clonado.");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("\n❌ ROLLBACK por error:", e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}
main();
