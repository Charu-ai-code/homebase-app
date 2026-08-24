import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

for (const file of ['.env.local', '.env']) {
  const path = join(root, file);
  if (existsSync(path)) {
    dotenv.config({ path });
    break;
  }
}
