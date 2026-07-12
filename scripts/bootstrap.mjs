#!/usr/bin/env node
/**
 * One-command Cloudflare provisioning.
 *
 *   npm run bootstrap
 *
 * Creates the D1 database, the R2 bucket and the KV namespace, then prints the
 * exact IDs to paste into `wrangler.jsonc`. It is idempotent: a resource that
 * already exists is reported and left alone, so re-running after a partial
 * failure is safe.
 *
 * It deliberately does NOT write to wrangler.jsonc automatically — the file has
 * comments that a naive rewrite would strip, and quietly editing a checked-in
 * config is exactly the kind of "magic" that makes a deployment hard to reason
 * about six months later.
 */
import { execSync } from 'node:child_process';

const DB_NAME = 'ondereyecioglu-db';
const BUCKET_NAME = 'ondereyecioglu-media';
const KV_TITLE = 'ondereyecioglu-kv';

const run = (command) => {
  try {
    return { ok: true, output: execSync(command, { encoding: 'utf8', stdio: 'pipe' }) };
  } catch (error) {
    return {
      ok: false,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    };
  }
};

const alreadyExists = (output) =>
  /already exists|already have|duplicate/i.test(output);

console.log('\nProvisioning Cloudflare resources…\n');

/* ── D1 ─────────────────────────────────────────────────────────────────── */
console.log(`  D1     ${DB_NAME}`);
const d1 = run(`npx wrangler d1 create ${DB_NAME}`);

let databaseId = null;
if (d1.ok) {
  databaseId = /database_id\s*=\s*"([^"]+)"/.exec(d1.output)?.[1]
    ?? /"database_id":\s*"([^"]+)"/.exec(d1.output)?.[1]
    ?? null;
  console.log(databaseId ? `         created — ${databaseId}` : '         created (see output below)');
  if (!databaseId) console.log(d1.output);
} else if (alreadyExists(d1.output)) {
  console.log('         already exists — fetching id…');
  const list = run('npx wrangler d1 list --json');
  if (list.ok) {
    try {
      const found = JSON.parse(list.output).find((row) => row.name === DB_NAME);
      databaseId = found?.uuid ?? found?.database_id ?? null;
      if (databaseId) console.log(`         ${databaseId}`);
    } catch {
      /* fall through to the manual instruction below */
    }
  }
} else {
  console.log(`         FAILED\n${d1.output}`);
}

/* ── R2 ─────────────────────────────────────────────────────────────────── */
console.log(`\n  R2     ${BUCKET_NAME}`);
const r2 = run(`npx wrangler r2 bucket create ${BUCKET_NAME}`);
console.log(
  r2.ok
    ? '         created'
    : alreadyExists(r2.output)
      ? '         already exists'
      : `         FAILED\n${r2.output}`,
);

/* ── KV ─────────────────────────────────────────────────────────────────── */
console.log(`\n  KV     ${KV_TITLE}`);
const kv = run(`npx wrangler kv namespace create KV`);

let kvId = null;
if (kv.ok) {
  kvId = /id\s*=\s*"([^"]+)"/.exec(kv.output)?.[1]
    ?? /"id":\s*"([^"]+)"/.exec(kv.output)?.[1]
    ?? null;
  console.log(kvId ? `         created — ${kvId}` : '         created (see output below)');
  if (!kvId) console.log(kv.output);
} else if (alreadyExists(kv.output)) {
  console.log('         already exists — run `npx wrangler kv namespace list` for the id');
} else {
  console.log(`         FAILED\n${kv.output}`);
}

/* ── Next steps ─────────────────────────────────────────────────────────── */
console.log('\n' + '─'.repeat(72));
console.log('\nNext steps\n');

console.log('1. Paste the IDs into wrangler.jsonc:\n');
if (databaseId) console.log(`     d1_databases[0].database_id  →  "${databaseId}"`);
else console.log('     d1_databases[0].database_id  →  (npx wrangler d1 list)');
if (kvId) console.log(`     kv_namespaces[0].id          →  "${kvId}"`);
else console.log('     kv_namespaces[0].id          →  (npx wrangler kv namespace list)');

console.log('\n2. Set the secrets:\n');
console.log('     npx wrangler secret put JWT_SECRET            # openssl rand -base64 48');
console.log('     npx wrangler secret put TURNSTILE_SECRET_KEY');
console.log('     npx wrangler secret put RESEND_API_KEY        # optional');

console.log('\n3. Migrate and seed:\n');
console.log('     npm run db:migrate:remote');
console.log('     npm run db:seed:remote');

console.log('\n4. Deploy:\n');
console.log('     npm run deploy\n');
