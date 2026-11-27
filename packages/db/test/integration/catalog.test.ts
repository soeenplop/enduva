// Catalog checks of the role model (ADR-0002). They also cover tables added later: every table in `app` must be
// owned by enduva_owner with row-level security enabled and forced, and nothing in `app` may be reachable by the
// Data API roles.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/index.js';
import { adminUrl, apiUrl, openDatabase, workerUrl } from './support.js';

let admin: Database;
beforeAll(() => {
  admin = openDatabase(adminUrl());
});
afterAll(async () => {
  await admin.$client.end();
});

const query = async <T extends Record<string, unknown>>(statement: ReturnType<typeof sql>) =>
  (await admin.execute<T>(statement)).rows;

const DATA_API_ROLES = ['anon', 'authenticated', 'service_role'];

describe('roles', () => {
  it.each([
    ['enduva_owner', false],
    ['enduva_api', false],
    ['enduva_worker', false],
    ['enduva_api_login', true],
    ['enduva_worker_login', true],
  ])('%s has no elevated attributes (login: %s)', async (role, canLogin) => {
    const rows = await query(
      sql`select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolinherit, rolcanlogin
          from pg_roles where rolname = ${role}`,
    );
    expect(rows).toEqual([
      {
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
        rolinherit: false,
        rolcanlogin: canLogin,
      },
    ]);
  });

  // The migration role (postgres) also holds ADMIN OPTION on every role it created, without SET or INHERIT.
  it('gives each login exactly its own role, without inheritance', async () => {
    const rows = await query(
      sql`select m.roleid::regrole::text as role, m.member::regrole::text as member, m.inherit_option, m.set_option
          from pg_auth_members m
          where m.member::regrole::text like 'enduva\\_%'
             or (m.roleid::regrole::text in ('enduva_api', 'enduva_worker') and (m.inherit_option or m.set_option))
          order by 1, 2`,
    );
    expect(rows).toEqual([
      { role: 'enduva_api', member: 'enduva_api_login', inherit_option: false, set_option: true },
      { role: 'enduva_worker', member: 'enduva_worker_login', inherit_option: false, set_option: true },
    ]);
  });

  it.each([
    ['enduva_api_login', apiUrl],
    ['enduva_worker_login', workerUrl],
  ])('%s can log in through the pooler', async (role, url) => {
    const db = openDatabase(url('pooler'));
    try {
      const { rows } = await db.execute<{ user: string }>(sql`select session_user::text as user`);
      expect(rows).toEqual([{ user: role }]);
    } finally {
      await db.$client.end();
    }
  });
});

describe('schema app', () => {
  it('holds the account tables', async () => {
    const rows = await query<{ table: string }>(
      sql`select relname::text as table from pg_class
          where relnamespace = 'app'::regnamespace and relkind in ('r', 'p') order by 1`,
    );
    expect(rows.map((row) => row.table)).toEqual(['consents', 'devices', 'entitlements', 'profiles', 'user_settings']);
  });

  it('has every table owned by enduva_owner, with row-level security enabled, forced and a policy', async () => {
    const rows = await query(
      sql`select c.relname::text as table, pg_get_userbyid(c.relowner)::text as owner,
                 c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
                 exists (select from pg_policy p where p.polrelid = c.oid) as has_policy
          from pg_class c where c.relnamespace = 'app'::regnamespace and c.relkind in ('r', 'p')`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toEqual({ table: row.table, owner: 'enduva_owner', enabled: true, forced: true, has_policy: true });
    }
  });

  it('has every relation and function owned by enduva_owner, and the schema by the migration role', async () => {
    const rows = await query(
      sql`select 'relation' as kind, relname::text as name from pg_class
          where relnamespace = 'app'::regnamespace and pg_get_userbyid(relowner) <> 'enduva_owner'
          union all
          select 'function', proname::text from pg_proc
          where pronamespace = 'app'::regnamespace and pg_get_userbyid(proowner) <> 'enduva_owner'
          union all
          select 'schema', nspname::text from pg_namespace
          where nspname = 'app' and pg_get_userbyid(nspowner) like 'enduva\\_%'`,
    );
    expect(rows).toEqual([]);
  });

  it.each(DATA_API_ROLES)('is unreachable for %s', async (role) => {
    const rows = await query(
      sql`select has_schema_privilege(${role}, 'app', 'usage') as schema_usage,
                 bool_or(has_table_privilege(${role}, c.oid, 'select, insert, update, delete, truncate, references, trigger')) as table_privilege,
                 (select bool_or(has_function_privilege(${role}, p.oid, 'execute')) from pg_proc p
                  where p.pronamespace = 'app'::regnamespace) as function_privilege
          from pg_class c where c.relnamespace = 'app'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')`,
    );
    expect(rows).toEqual([{ schema_usage: false, table_privilege: false, function_privilege: false }]);
  });

  it('grants nothing to PUBLIC', async () => {
    const rows = await query(
      sql`select c.relname::text as name from pg_class c, aclexplode(c.relacl) a
          where c.relnamespace = 'app'::regnamespace and a.grantee = 0
          union all
          select p.proname::text from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where p.pronamespace = 'app'::regnamespace and a.grantee = 0
          union all
          select n.nspname::text from pg_namespace n, aclexplode(n.nspacl) a
          where n.nspname = 'app' and a.grantee = 0`,
    );
    expect(rows).toEqual([]);
  });

  it('lets the API role delete nothing and never edit ownership or authorisation columns', async () => {
    const rows = await query(
      sql`select bool_or(has_table_privilege('enduva_api', c.oid, 'delete, truncate')) as delete,
                 bool_or(has_column_privilege('enduva_api', c.oid, 'user_id', 'update')) as update_user_id,
                 has_column_privilege('enduva_api', 'app.profiles', 'role', 'update') as update_role,
                 has_table_privilege('enduva_api', 'app.entitlements', 'insert, update') as write_entitlements
          from pg_class c where c.relnamespace = 'app'::regnamespace and c.relkind in ('r', 'p')`,
    );
    expect(rows).toEqual([{ delete: false, update_user_id: false, update_role: false, write_entitlements: false }]);
  });
});
