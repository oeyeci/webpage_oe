#!/usr/bin/env node
/**
 * Local backup of D1 and R2.
 *
 *   npm run db:backup            # remote (production)
 *   npm run db:backup -- --local # local dev database
 *
 * Produces `backups/<timestamp>/`:
 *
 *   database.sql   — full SQL dump, restorable with `wrangler d1 execute --file`
 *   media/         — every object from the R2 bucket
 *   MANIFEST.txt   — what was captured, and how to restore it
 *
 * The admin panel's JSON export (/api/admin/backup) is the convenient,
 * human-readable version. This is the *complete* one: it includes the media
 * bytes, which JSON cannot carry.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv, exit } from 'node:process';

const DB_NAME = 'ondereyecioglu-db';
const BUCKET_NAME = 'ondereyecioglu-media';

const local = argv.includes('--local');
const target = local ? '--local' : '--remote';

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dir = resolve('backups', stamp);

mkdirSync(resolve(dir, 'media'), { recursive: true });

console.log(`\nBacking up ${local ? 'LOCAL' : 'REMOTE'} → backups/${stamp}/\n`);

/* ── D1 ─────────────────────────────────────────────────────────────────── */
process.stdout.write('  database … ');
try {
  execSync(
    `npx wrangler d1 export ${DB_NAME} ${target} --output "${resolve(dir, 'database.sql')}"`,
    { stdio: 'pipe' },
  );
  console.log('ok');
} catch (error) {
  console.log('FAILED');
  console.error(`${error.stdout ?? ''}${error.stderr ?? ''}`);
  exit(1);
}

/* ── R2 ─────────────────────────────────────────────────────────────────── */
process.stdout.write('  media    … ');
let objectCount = 0;

try {
  // `r2 object get` works one key at a time, so the keys are listed first.
  const listed = execSync(`npx wrangler r2 bucket object list ${BUCKET_NAME} ${target} --json`, {
    encoding: 'utf8',
    stdio: 'pipe',
  });

  const objects = JSON.parse(listed).objects ?? JSON.parse(listed) ?? [];

  for (const object of objects) {
    const key = object.key ?? object.Key;
    if (!key) continue;

    const destination = resolve(dir, 'media', key.replace(/[/\\]/g, '__'));
    execSync(
      `npx wrangler r2 object get ${BUCKET_NAME}/${key} ${target} --file "${destination}"`,
      { stdio: 'pipe' },
    );
    objectCount += 1;
  }

  console.log(`ok (${objectCount} objects)`);
} catch (error) {
  // A media failure must not discard the database dump we already have.
  console.log('FAILED (the database dump above is still valid)');
  console.error(`${error.stdout ?? ''}${error.stderr ?? ''}`.slice(0, 500));
}

/* ── Manifest ───────────────────────────────────────────────────────────── */
writeFileSync(
  resolve(dir, 'MANIFEST.txt'),
  [
    `Backup      ${stamp}`,
    `Source      ${local ? 'local' : 'remote (production)'}`,
    `Database    ${DB_NAME}`,
    `Bucket      ${BUCKET_NAME}`,
    `Objects     ${objectCount}`,
    '',
    'RESTORE',
    '',
    '  1. Database:',
    `       npx wrangler d1 execute ${DB_NAME} ${target} --file=./database.sql`,
    '',
    '  2. Media — object keys had "/" replaced with "__" to flatten them onto',
    '     the filesystem. Reverse that when re-uploading:',
    '',
    `       npx wrangler r2 object put ${BUCKET_NAME}/<original/key> ${target} --file <file>`,
    '',
    'NOTE: the database dump includes password hashes and contact messages.',
    'Store it accordingly.',
    '',
  ].join('\n'),
  'utf8',
);

console.log(`\n✓ backups/${stamp}/\n`);
if (!existsSync(resolve('.gitignore'))) {
  console.log('  Warning: no .gitignore found — make sure backups/ is not committed.\n');
}
