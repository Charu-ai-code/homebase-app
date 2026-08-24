#!/usr/bin/env node
/**
 * Push .env.local → Vercel (production + preview + development).
 * Run once after deploy: node scripts/push-vercel-env.mjs
 */
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skip = new Set(['VERCEL_OIDC_TOKEN', 'CHARU_PIN', 'SHREYA_PIN']);
const overrides = { APP_BASE_URL: 'https://homebase-app-pied.vercel.app' };

const text = readFileSync(join(root, '.env.local'), 'utf8');
const vars = [];
for (const line of text.split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m || skip.has(m[1])) continue;
  let val = m[2].trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  if (overrides[m[1]]) val = overrides[m[1]];
  vars.push({ name: m[1], val });
}

console.log(`Pushing ${vars.length} variables to Vercel…`);
for (const { name, val } of vars) {
  for (const env of ['production', 'preview', 'development']) {
    const r = spawnSync('npx', ['vercel', 'env', 'add', name, env, '--force'], {
      input: val,
      encoding: 'utf8',
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (r.status !== 0) {
      console.error(`FAIL ${name} (${env}):`, (r.stderr || r.stdout || '').slice(0, 200));
      process.exit(1);
    }
    console.log(`  ${name} → ${env}`);
  }
}
console.log('Done. Redeploy: npx vercel --prod --yes');
