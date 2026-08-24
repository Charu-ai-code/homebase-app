import { json, readJson } from '../../_lib/response.js';
import { requireAuth } from '../../_lib/auth.js';
import { getDb } from '../../_lib/db.js';
import { importHomeBaseJson, normalizeImportPayload } from '../../_lib/import-json.js';
import { invalidateCache } from '../../_lib/ai.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    json(res, 200, {
      schemaVersion: 1,
      docs: '/docs/ai-recipe-import-prompt.md',
      exampleSingleRecipe: {
        recipe_name: 'Butter Chicken',
        meal_type: 'dinner',
        minutes: 40,
        kcal: 520,
        protein_g: 36,
        servings: '2',
        source_name: 'Instagram @chef',
        source_url: 'https://instagram.com/p/…',
        method: [
          'Marinate chicken in yogurt and spices',
          'Simmer tomato-butter gravy',
          'Finish with cream',
        ],
        ingredients: [
          { ingredient: 'Chicken thighs', quantity: '500 g', aisle: 'Meat + dairy' },
          { ingredient: 'Tomato puree', quantity: '1 cup', aisle: 'Pantry' },
        ],
      },
    });
    return;
  }

  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  try {
    const body = await readJson(req);
    normalizeImportPayload(body);
    const sql = getDb();
    const result = await importHomeBaseJson(sql, auth.person.id, body);
    await invalidateCache('mealplan');
    json(res, 200, { ok: true, ...result });
  } catch (err) {
    console.error('import-json error', err);
    json(res, 400, { error: err.message || 'Import failed' });
  }
}
