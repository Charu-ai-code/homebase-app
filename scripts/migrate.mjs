import './load-env.mjs';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const dir = join(__dirname, '../db/migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    for (const file of files) {
      const sqlText = readFileSync(join(dir, file), 'utf8');
      try {
        await pool.query(sqlText);
        console.log('OK', file);
      } catch (err) {
        if (err.code === '42P07' || err.message?.includes('already exists')) {
          console.log('SKIP', file, '(already applied)');
        } else {
          throw err;
        }
      }
    }
    console.log('Migration complete.');
  } finally {
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
