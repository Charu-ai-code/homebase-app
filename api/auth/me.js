import { json } from '../_lib/response.js';
import { requireAuth } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  json(res, 200, {
    person: {
      id: auth.person.id,
      name: auth.person.name,
      color: auth.person.color,
      calorieTarget: auth.person.calorie_target,
    },
  });
}
