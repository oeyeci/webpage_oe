#!/usr/bin/env node
/**
 * Generates a PBKDF2 hash for an administrator password.
 *
 *   npm run admin:password -- 'my new password'
 *   npm run admin:password              (prompts, and never echoes)
 *
 * The output goes straight into the `users.password_hash` column:
 *
 *   npx wrangler d1 execute ondereyecioglu-db --remote \
 *     --command "UPDATE users SET password_hash = '<hash>', must_change_password = 0 \
 *                WHERE email = 'you@example.com';"
 *
 * Uses the same parameters as src/lib/auth/password.ts (PBKDF2-SHA256, 600,000
 * iterations — the current OWASP floor). Deliberately duplicated here rather
 * than imported so this script has zero build step and works on a bare
 * checkout.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout, argv, exit } from 'node:process';

const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    KEY_BITS,
  );

  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`;
}

function assess(password) {
  if (password.length < 12) return 'Use at least 12 characters.';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) {
    return 'Use at least three of: lowercase, uppercase, numbers, symbols.';
  }
  return null;
}

const provided = argv.slice(2).join(' ').trim();

let password = provided;
if (!password) {
  const rl = createInterface({ input: stdin, output: stdout });
  password = (await rl.question('New password: ')).trim();
  rl.close();
}

if (!password) {
  console.error('No password provided.');
  exit(1);
}

const problem = assess(password);
if (problem) {
  console.error(`\n✗ ${problem}\n`);
  exit(1);
}

const hash = await hashPassword(password);

console.log('\nPassword hash (PBKDF2-SHA256, 600,000 iterations):\n');
console.log(`  ${hash}\n`);
console.log('Apply it with:\n');
console.log('  npx wrangler d1 execute ondereyecioglu-db --remote \\');
console.log(`    --command "UPDATE users SET password_hash = '${hash}', must_change_password = 0 WHERE email = 'you@example.com';"\n`);
