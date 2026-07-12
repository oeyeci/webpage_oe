import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit is used ONLY to generate SQL migrations from the schema.
 * The migrations themselves are applied by Wrangler
 * (`wrangler d1 migrations apply`), which is D1's native migration runner.
 */
export default defineConfig({
  dialect: 'sqlite',
  driver: 'd1-http',
  schema: './src/lib/db/schema.ts',
  out: './migrations',
  casing: 'snake_case',
  verbose: true,
  strict: true,
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
    databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID ?? '',
    token: process.env.CLOUDFLARE_API_TOKEN ?? '',
  },
});
