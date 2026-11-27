// Catalog checks of the role model (ADR-0002). They also cover tables added later: every table in `app` must be
// owned by enduva_owner with row-level security enabled and forced, and nothing in `app` may be reachable by the
// Data API roles.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/index.js';
import { adminUrl, apiUrl, openDatabase, rolledBack, workerUrl } from './support.js';

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
            and oid <> 'app.auth_session_active()'::regprocedure
          union all
          select 'schema', nspname::text from pg_namespace
          where nspname = 'app' and pg_get_userbyid(nspowner) like 'enduva\\_%'`,
    );
    expect(rows).toEqual([]);
  });

  // The session check reads Supabase's `auth` schema, which only the migration role can (ADR-0002 → Session check).
  it('has exactly one SECURITY DEFINER function: the session check, owned by postgres and callable by the API only', async () => {
    const rows = await query(
      sql`select p.oid::regprocedure::text as function, pg_get_userbyid(p.proowner)::text as owner, p.proconfig as config,
                 p.provolatile as volatility,
                 array(select a.grantee::regrole::text from aclexplode(p.proacl) a
                       where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner order by 1) as execute
          from pg_proc p where p.pronamespace = 'app'::regnamespace and p.prosecdef`,
    );
    expect(rows).toEqual([
      {
        function: 'app.auth_session_active()',
        owner: 'postgres',
        config: ['search_path=""'],
        volatility: 's',
        execute: ['enduva_api'],
      },
    ]);
  });

  it.each(DATA_API_ROLES)('is unreachable for %s', async (role) => {
    const rows = await query(
      sql`select has_schema_privilege(${role}, 'app', 'usage') as schema_usage,
                 bool_or(has_table_privilege(${role}, c.oid, 'select, insert, update, delete, truncate, references, trigger')) as table_privilege,
                 bool_or(has_any_column_privilege(${role}, c.oid, 'select, insert, update, references')) as column_privilege,
                 (select bool_or(has_function_privilege(${role}, p.oid, 'execute')) from pg_proc p
                  where p.pronamespace = 'app'::regnamespace) as function_privilege
          from pg_class c where c.relnamespace = 'app'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')`,
    );
    expect(rows).toEqual([
      { schema_usage: false, table_privilege: false, column_privilege: false, function_privilege: false },
    ]);
  });

  it('grants nothing to PUBLIC or a Data API role, on tables, columns, functions or the schema', async () => {
    const rows = await query(
      sql`with grants as (
            select c.relname::text as name, a.grantee from pg_class c, aclexplode(c.relacl) a
            where c.relnamespace = 'app'::regnamespace
            union all
            select c.relname || '.' || att.attname, a.grantee
            from pg_attribute att join pg_class c on c.oid = att.attrelid, aclexplode(att.attacl) a
            where c.relnamespace = 'app'::regnamespace
            union all
            select p.proname::text, a.grantee from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where p.pronamespace = 'app'::regnamespace
            union all
            select n.nspname::text, a.grantee from pg_namespace n, aclexplode(n.nspacl) a where n.nspname = 'app')
          select name, case grantee when 0 then 'public' else grantee::regrole::text end as grantee from grants
          where grantee = 0 or grantee::regrole::text in ('anon', 'authenticated', 'service_role')`,
    );
    expect(rows).toEqual([]);
  });

  it("gives enduva_owner's new functions no EXECUTE for PUBLIC", async () => {
    // The global default (schema-scoped defaults can't revoke it), checked on a function created like a migration
    // does and rolled back.
    const acl = await rolledBack(
      (fn) => admin.transaction(fn),
      async (tx) => {
        await tx.execute(sql`set local role enduva_owner`);
        await tx.execute(sql`create function app.default_acl_probe() returns int language sql as 'select 1'`);
        const { rows } = await tx.execute<{ owner: string; public_execute: boolean }>(
          sql`select pg_get_userbyid(p.proowner)::text as owner,
                     exists (select from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                             where a.grantee = 0) as public_execute
              from pg_proc p where p.oid = 'app.default_acl_probe()'::regprocedure`,
        );
        return rows;
      },
    );
    expect(acl).toEqual([{ owner: 'enduva_owner', public_execute: false }]);
  });
});

// What each runtime role may do, column by column (supabase/migrations/…_account_security.sql). A snapshot, so any
// widened grant fails here even before a behavioural test notices. `*` is a table-level grant.
describe('runtime role grants', () => {
  it('are exactly the reviewed set', async () => {
    const rows = await query<{ grant: string }>(
      sql`with grants as (
            select a.grantee::regrole::text as role, a.privilege_type as privilege, c.relname::text as table, '*' as col
            from pg_class c, aclexplode(c.relacl) a
            where c.relnamespace = 'app'::regnamespace and a.grantee::regrole::text in ('enduva_api', 'enduva_worker')
            union all
            select a.grantee::regrole::text, a.privilege_type, c.relname::text, att.attname::text
            from pg_attribute att join pg_class c on c.oid = att.attrelid, aclexplode(att.attacl) a
            where c.relnamespace = 'app'::regnamespace and a.grantee::regrole::text in ('enduva_api', 'enduva_worker'))
          select role || ' ' || privilege || ' ' || "table" || '(' || string_agg(col, ', ' order by col) || ')' as grant
          from grants group by role, privilege, "table" order by 1`,
    );
    expect(rows.map((row) => row.grant)).toEqual([
      'enduva_api INSERT consents(consent_version, purpose, user_id)',
      'enduva_api INSERT devices(auth_session_id, kind, last_seen_at, name, user_id)',
      'enduva_api INSERT profiles(avatar_path, birth_date, display_name, height_cm, locale, onboarding_completed_at, sex, time_zone, user_id)',
      'enduva_api INSERT user_settings(health_sync, notification_prefs, theme, user_id, week_start)',
      'enduva_api SELECT consents(*)',
      'enduva_api SELECT devices(*)',
      'enduva_api SELECT entitlements(*)',
      'enduva_api SELECT profiles(*)',
      'enduva_api SELECT user_settings(*)',
      'enduva_api UPDATE consents(revoked_at)',
      'enduva_api UPDATE devices(last_seen_at, name, revoked_at)',
      'enduva_api UPDATE profiles(avatar_path, birth_date, display_name, height_cm, locale, onboarding_completed_at, sex, time_zone)',
      'enduva_api UPDATE user_settings(health_sync, notification_prefs, theme, week_start)',
      'enduva_worker DELETE profiles(*)',
      'enduva_worker INSERT entitlements(external_id, source, tier, user_id, valid_from, valid_until)',
      'enduva_worker SELECT consents(*)',
      'enduva_worker SELECT devices(*)',
      'enduva_worker SELECT entitlements(*)',
      'enduva_worker SELECT profiles(*)',
      'enduva_worker SELECT user_settings(*)',
      'enduva_worker UPDATE consents(revoked_at)',
      'enduva_worker UPDATE devices(last_seen_at, revoked_at)',
      'enduva_worker UPDATE entitlements(tier, valid_from, valid_until)',
      'enduva_worker UPDATE profiles(avatar_path, birth_date, display_name, height_cm, locale, onboarding_completed_at, sex, time_zone)',
      'enduva_worker UPDATE user_settings(health_sync, notification_prefs, theme, week_start)',
    ]);
  });

  it('never let a runtime role write ownership, authorisation or server-maintained columns', async () => {
    const rows = await query(
      sql`select c.relname::text as table, att.attname::text as column, r.role, p.privilege
          from pg_class c join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped,
               unnest(array['enduva_api', 'enduva_worker']) r(role), unnest(array['INSERT', 'UPDATE']) p(privilege)
          where c.relnamespace = 'app'::regnamespace and c.relkind in ('r', 'p')
            and has_column_privilege(r.role, c.oid, att.attnum, p.privilege)
            and (att.attname in ('role', 'id', 'version', 'created_at', 'updated_at', 'granted_at')
                 or (p.privilege = 'UPDATE' and att.attname = 'user_id')
                 or (p.privilege = 'INSERT' and att.attname = 'revoked_at')
                 or (c.relname = 'entitlements' and r.role = 'enduva_api'))
          order by 1, 2, 3, 4`,
    );
    expect(rows).toEqual([]);
  });

  it('delete nothing but whole accounts (the worker, through profiles)', async () => {
    const rows = await query(
      sql`select c.relname::text as table, r.role from pg_class c, unnest(array['enduva_api', 'enduva_worker']) r(role)
          where c.relnamespace = 'app'::regnamespace and c.relkind in ('r', 'p')
            and has_table_privilege(r.role, c.oid, 'delete, truncate')`,
    );
    expect(rows).toEqual([{ table: 'profiles', role: 'enduva_worker' }]);
  });

  it('keep revocations one-way with a trigger on consents and devices', async () => {
    const rows = await query(
      sql`select tgrelid::regclass::text as table, tgenabled as enabled from pg_trigger
          where tgfoid = 'app.keep_revocation()'::regprocedure order by 1`,
    );
    expect(rows).toEqual([
      { table: 'app.consents', enabled: 'O' },
      { table: 'app.devices', enabled: 'O' },
    ]);
  });
});
