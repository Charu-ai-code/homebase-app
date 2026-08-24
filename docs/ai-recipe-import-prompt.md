# HomeBase — AI recipe JSON (copy into any chatbot)

Use this when you have an Instagram recipe, blog post, or screenshot text. Paste the **prompt block** below, then paste the recipe. The AI should return **only JSON** — paste that into HomeBase (**Recipes → IMPORT JSON**).

---

## Prompt block (copy everything in the box)

```
You convert recipes into HomeBase JSON. Return ONLY valid JSON — no markdown, no explanation.

Rules:
- recipe_name: clear dish title
- meal_type: breakfast | lunch | dinner | snack | side | drink | shake | dessert
- method: array of short step strings (or one string)
- kcal and protein_g: estimate per serving if not given (integers)
- minutes: active cook time (integer or null)
- source_name: e.g. "Instagram @handle" if known
- source_url: post URL if known
- ingredients: every ingredient with quantity and aisle

Aisles: Produce | Meat + dairy | Pantry | Frozen | Bakery | Spices | Other

Schema (single recipe — use this shape):

{
  "recipe_name": "",
  "meal_type": "dinner",
  "minutes": null,
  "kcal": null,
  "protein_g": null,
  "servings": "2",
  "method": ["step 1", "step 2"],
  "cook_method": "stovetop",
  "source_name": null,
  "source_url": null,
  "notes": null,
  "ingredients": [
    { "ingredient": "", "quantity": "", "aisle": "Pantry", "note": null }
  ]
}

Convert this recipe:
```

Then paste the Insta caption / recipe text after the last line.

---

## Example output (what the AI should return)

```json
{
  "recipe_name": "One-Pot Lemon Orzo",
  "meal_type": "dinner",
  "minutes": 25,
  "kcal": 420,
  "protein_g": 18,
  "servings": "2",
  "method": [
    "Sauté garlic in olive oil",
    "Add orzo and toast 1 minute",
    "Pour broth and lemon juice; simmer until tender",
    "Stir in spinach and parmesan"
  ],
  "cook_method": "stovetop",
  "source_name": "Instagram @example",
  "source_url": "https://instagram.com/p/example",
  "notes": null,
  "ingredients": [
    { "ingredient": "Orzo", "quantity": "1 cup", "aisle": "Pantry" },
    { "ingredient": "Vegetable broth", "quantity": "3 cups", "aisle": "Pantry" },
    { "ingredient": "Lemon", "quantity": "1", "aisle": "Produce" },
    { "ingredient": "Baby spinach", "quantity": "2 cups", "aisle": "Produce" },
    { "ingredient": "Parmesan", "quantity": "1/4 cup", "aisle": "Meat + dairy" }
  ]
}
```

---

## Import in HomeBase

1. **PLAN → RECIPES**
2. Click **IMPORT JSON**
3. Paste the AI JSON
4. Click **IMPORT**

Existing recipes with the same name are **updated** (not duplicated).

---

## Multiple recipes at once

Ask the AI to return:

```json
{
  "recipes": [
    { "recipe_name": "...", "meal_type": "dinner", "kcal": 400, "protein_g": 25, "method": ["..."] }
  ],
  "ingredients": [
    { "recipe_name": "...", "ingredient": "...", "quantity": "...", "aisle": "Pantry" }
  ]
}
```

---

## Full week (meal plan)

See `data/homebase_seed_aug24_2026_two_person.json` for the full format with `week_start`, `week_end`, `meal_plan`, and `prep`.

Machine-readable schema: `docs/ai-recipe-json-schema.json`
