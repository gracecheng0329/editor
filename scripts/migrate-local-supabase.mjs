import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Local Apple container only. No database reset, credentials, or remote target.
const directory = new URL('../supabase/migrations/', import.meta.url);
const migrations = readdirSync(directory).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
let sql = `begin;
select pg_advisory_xact_lock(721034891);
create schema if not exists editor_migrations;
revoke all on schema editor_migrations from public;
create table if not exists editor_migrations.applied (name text primary key, checksum text not null, applied_at timestamptz not null default now());
`;
for (const name of migrations) {
  const body = readFileSync(new URL(name, directory), 'utf8');
  const checksum = createHash('sha256').update(body).digest('hex');
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  sql += `do $migration$ begin
  if exists (select 1 from editor_migrations.applied where name = ${quote(name)} and checksum <> ${quote(checksum)}) then
    raise exception 'Applied migration changed: %', ${quote(name)};
  elsif not exists (select 1 from editor_migrations.applied where name = ${quote(name)}) then
    execute ${quote(body)};
    insert into editor_migrations.applied(name, checksum) values (${quote(name)}, ${quote(checksum)});
  end if;
end $migration$;\n`;
}
sql += "notify pgrst, 'reload schema'; commit;";
const result = spawnSync('container', ['exec', '--interactive', 'editor-supabase-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)), input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
});
if (result.error || result.status !== 0) {
  console.error(result.error?.message ?? result.stderr);
  process.exit(1);
}
console.log(`Local migrations applied or already current (${migrations.length}); existing rows retained.`);
