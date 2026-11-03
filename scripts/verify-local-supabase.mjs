import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const settings = JSON.parse(await readFile(resolve(root, ".local-supabase/credentials.json"), "utf8"));
const api = "http://127.0.0.1:54321";
const table = `local_probe_${randomBytes(6).toString("hex")}`;
const password = randomBytes(24).toString("hex");
const users = [];

function command(executable, args, input) {
  return new Promise((accept, reject) => {
    const child = spawn(executable, args, { cwd: root, stdio: [input === undefined ? "ignore" : "pipe", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? accept() : reject(new Error(`${executable} exited ${code}`)));
    if (input !== undefined) child.stdin.end(input);
  });
}

const sql = (query) => command("container", ["exec", "--interactive", "editor-supabase-db", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], query);

async function request(path, { token = settings.anonKey, key = settings.anonKey, method = "GET", body, headers = {} } = {}) {
  const result = await fetch(`${api}${path}`, {
    method, headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const text = await result.text();
  return { status: result.status, body: text ? JSON.parse(text) : null };
}

try {
  for (const person of ["a", "b"]) {
    const email = `${table}-${person}@example.test`;
    const created = await request("/auth/v1/admin/users", { key: settings.serviceKey, token: settings.serviceKey, method: "POST", body: { email, password, email_confirm: true } });
    assert.equal(created.status, 200, "Auth admin can create a dedicated test user");
    assert.match(created.body.id, /^[0-9a-f-]{36}$/);
    users.push(created.body.id);
    const session = await request("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
    assert.equal(session.status, 200, "Real Auth password login succeeds");
    assert.ok(session.body.access_token);
    settings[person] = session.body.access_token;
  }
  console.log("PASS: two real, independent Auth sessions");
  await sql(`
    create table public.${table} (id integer primary key, owner_id uuid not null default auth.uid(), title text not null);
    alter table public.${table} enable row level security;
    grant select, insert, update on public.${table} to authenticated;
    grant select on public.${table} to anon;
    create policy owner_access on public.${table} to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
    notify pgrst, 'reload schema';
  `);
  // Wait for the public REST schema cache notification, not a fixed sleep.
  const deadline = Date.now() + 15_000;
  while (true) {
    const result = await request(`/rest/v1/${table}`, { token: settings.a });
    if (result.status === 200) break;
    if (Date.now() > deadline) throw new Error("REST schema cache did not expose probe table");
    await new Promise((accept) => setTimeout(accept, 200));
  }
  const inserted = await request(`/rest/v1/${table}`, { token: settings.a, method: "POST", body: { id: 1, title: "persisted owner document" } });
  assert.equal(inserted.status, 201);
  const own = await request(`/rest/v1/${table}?select=title`, { token: settings.a });
  assert.equal(own.status, 200);
  assert.deepEqual(own.body, [{ title: "persisted owner document" }]);
  for (const token of [settings.anonKey, settings.b]) {
    const hidden = await request(`/rest/v1/${table}`, { token });
    assert.equal(hidden.status, 200);
    assert.deepEqual(hidden.body, [], "RLS hides the other user's row");
  }
  const forbidden = await request(`/rest/v1/${table}?id=eq.1`, { token: settings.b, method: "PATCH", body: { title: "unauthorized change" }, headers: { Prefer: "return=representation" } });
  assert.equal(forbidden.status, 200);
  assert.deepEqual(forbidden.body, [], "RLS prevents another user changing the row");
  console.log("PASS: REST writes/readback and database-enforced user isolation");
  if (process.argv.includes("--restart")) {
    await command(process.execPath, ["scripts/local-supabase.mjs", "stop"]);
    await command(process.execPath, ["scripts/local-supabase.mjs", "up"]);
    console.log("PASS: all services stop and restart successfully");
  }
  const saved = await request(`/rest/v1/${table}?select=title`, { token: settings.a });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body, [{ title: "persisted owner document" }]);
  console.log("PASS: saved data remains readable by its owner");
  const noKey = await fetch(`${api}/rest/v1/${table}`, { signal: AbortSignal.timeout(5000) });
  assert.equal(noKey.status, 401);
  console.log("PASS: gateway rejects requests without an API key");
  const studio = await fetch("http://127.0.0.1:54323", { signal: AbortSignal.timeout(15_000) });
  assert.equal(studio.status, 200);
  console.log("PASS: Studio page responds");
  // Query through Studio's postgres-meta connection, not just its profile stub.
  await command("container", ["exec", "editor-supabase-studio", "node", "-e", "fetch(process.env.STUDIO_PG_META_URL+'/tables').then(async r=>{if(!r.ok)process.exit(1);const data=await r.json();if(!Array.isArray(data))process.exit(1)}).catch(()=>process.exit(1))"]);
  console.log("PASS: Studio can query database metadata");
} finally {
  await sql(`drop table if exists public.${table}; notify pgrst, 'reload schema';`);
  for (const id of users) {
    const removed = await request(`/auth/v1/admin/users/${id}`, { key: settings.serviceKey, token: settings.serviceKey, method: "DELETE" });
    assert.equal(removed.status, 200, "Probe users are cleaned up");
  }
}
