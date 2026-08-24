import './env.js';
import OpenAI from 'openai';
import { getDb } from './db.js';

let resolvedModel;

function listProviders() {
  const preferred = (process.env.AI_PROVIDER || '').toLowerCase();
  const providers = [];

  const deepseek = process.env.DEEPSEEK_API_KEY
    ? {
      name: 'deepseek',
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: 'https://api.deepseek.com',
      models: [process.env.DEEPSEEK_MODEL || 'deepseek-chat'],
    }
    : null;

  const kimiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
  const kimi = kimiKey
    ? {
      name: 'kimi',
      apiKey: kimiKey,
      baseURL: 'https://api.moonshot.ai/v1',
      models: [
        process.env.KIMI_MODEL,
        'moonshot-v1-8k',
        'kimi-k2.5',
        'moonshot-v1-32k',
      ].filter(Boolean),
    }
    : null;

  // Prefer DeepSeek when both exist (Kimi free tier often hits balance/429)
  if (preferred === 'kimi') {
    if (kimi) providers.push(kimi);
    if (deepseek) providers.push(deepseek);
  } else {
    if (deepseek) providers.push(deepseek);
    if (kimi) providers.push(kimi);
  }
  return providers;
}

function isBillingError(err) {
  return err?.status === 429
    || /insufficient balance|suspended|exceeded_current_quota|quota/i.test(err?.message || '');
}

export async function chat(system, user, { jsonMode = false } = {}) {
  const providers = listProviders();
  if (!providers.length) {
    throw new Error('KIMI_API_KEY (or DEEPSEEK_API_KEY) is not configured in .env.local');
  }

  let lastErr;
  for (const provider of providers) {
    const openai = new OpenAI({
      apiKey: provider.apiKey,
      baseURL: provider.baseURL,
    });
    for (const model of provider.models) {
      try {
        const response = await openai.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
          temperature: 0.4,
        });
        resolvedModel = `${provider.name}/${model}`;
        return response.choices[0]?.message?.content?.trim() || '';
      } catch (err) {
        lastErr = err;
        console.warn(`AI model failed (${provider.name}/${model}):`, err.message);
        if (isBillingError(err)) break; // try next provider
      }
    }
  }

  throw new Error(
    isBillingError(lastErr)
      ? 'AI account out of credit (429). Recharge Kimi or add a working DEEPSEEK_API_KEY to .env.local'
      : (lastErr?.message || 'All AI providers failed'),
  );
}

export function recipeImageUrl(name) {
  const prompt = encodeURIComponent(`${name}, plated food photography, appetizing, natural light`);
  return `https://image.pollinations.ai/prompt/${prompt}?width=800&height=1000&nologo=true`;
}

export async function estimateRecipe(name, extras = {}) {
  const raw = await chat(
    'You are a nutritionist for a home cooking app. Return ONLY valid JSON with keys: kcal (number per serving), protein (number grams), minutes (number), servings (string), tags (array of meal types from: drink,breakfast,shake,lunch,snack,dinner,dessert,side), method (array of 3-6 short step strings), ingredients (array of {name, qty, aisle} where aisle is Produce|Meat + dairy|Pantry|Frozen|Other). Be realistic.',
    JSON.stringify({ name, ...extras }),
    { jsonMode: true },
  );
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  return {
    name,
    kcal: Number(parsed.kcal) || 400,
    protein: Number(parsed.protein) || 15,
    minutes: Number(parsed.minutes) || 25,
    servings: parsed.servings || '2',
    tags: Array.isArray(parsed.tags) && parsed.tags.length ? parsed.tags : ['dinner'],
    method: Array.isArray(parsed.method) ? parsed.method : ['Prep ingredients', 'Cook', 'Serve'],
    ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients : [],
    imageUrl: recipeImageUrl(name),
  };
}

export async function getCachedInsight(cacheKey) {
  const sql = getDb();
  const rows = await sql`
    select content from ai_insight_cache where cache_key = ${cacheKey}
  `;
  return rows[0]?.content || null;
}

export async function setCachedInsight(cacheKey, content) {
  const sql = getDb();
  await sql`
    insert into ai_insight_cache (cache_key, content, generated_at)
    values (${cacheKey}, ${content}, now())
    on conflict (cache_key) do update
    set content = excluded.content, generated_at = now()
  `;
}

export async function invalidateCache(prefix) {
  const sql = getDb();
  await sql`delete from ai_insight_cache where cache_key like ${prefix + '%'}`;
}
