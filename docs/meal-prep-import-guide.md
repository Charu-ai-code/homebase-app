# HomeBase meal prep import — what to send

Share your Excel (or Google Sheet exported as `.xlsx` / `.csv`). I’ll use it to populate **Recipes** and the **Meal Plan** in HomeBase.

Use **one row per item** unless noted. Column names can vary slightly — I’ll map them — but matching the names below makes import fastest.

---

## Recommended workbook structure

| Sheet | Purpose |
|-------|---------|
| **Meal Plan** | What you eat each day, by meal slot |
| **Recipes** | Full recipe details (one row per dish) |
| **Ingredients** | Optional — one row per ingredient per recipe |
| **Prep** | Optional — marinate / thaw / batch-cook tasks |

If you only have one sheet, put **Recipes** on a separate tab if possible. A combined “week grid” alone works for the meal plan, but recipes need more detail somewhere.

---

## Sheet 1 — Meal Plan

**One row per day per meal slot.**

| Column | Required? | Example | Notes |
|--------|-----------|---------|-------|
| `date` | **Yes** | `2026-09-01` | Use `YYYY-MM-DD` or a clear date format |
| `day` | Optional | `Mon` | Helpful for you; I’ll derive from date |
| `slot` | **Yes** | `dinner` | See allowed slots below |
| `recipe_name` | **Yes*** | `Rajma Chawal` | Must match **Recipes** sheet exactly (or tell me aliases) |
| `adhoc_name` | Optional | `Leftover pizza` | For one-off items with no full recipe |
| `kcal` | Optional | `520` | Per serving for that slot; overrides recipe default |
| `protein_g` | Optional | `24` | Same |
| `who_eats` | Optional | `both` | `charu`, `shreya`, or `both` — if your sheet tracks this |
| `notes` | Optional | `use leftover rice` | Any day-specific note |

\*Use either `recipe_name` **or** `adhoc_name`. Link to a recipe when you have one.

### Allowed meal slots

| Slot key | Label in app |
|----------|----------------|
| `drink` | Morning drink |
| `breakfast` | Breakfast |
| `shake` | Shake |
| `lunch` | Lunch |
| `snack` | Snack |
| `dinner` | Dinner |
| `dessert` | Dessert |
| Custom | e.g. `second_breakfast` — tell me the label you want |

### Week coverage

- Tell me **which week(s)** to import: start date (e.g. `Mon 1 Sep 2026`) and how many weeks.
- If your Excel is a repeating rotation (Week A / Week B), note that and I’ll map it.

### Example — Meal Plan rows

| date | slot | recipe_name | kcal | protein_g | notes |
|------|------|-------------|------|-----------|-------|
| 2026-09-01 | drink | Jeera water | 15 | 0 | |
| 2026-09-01 | breakfast | Vegetable poha | 320 | 9 | |
| 2026-09-01 | shake | Whey banana shake | 210 | 24 | |
| 2026-09-01 | lunch | Dal brown rice salad | 480 | 22 | |
| 2026-09-01 | snack | Roasted chana fruit | 140 | 7 | |
| 2026-09-01 | dinner | Rajma Chawal | 520 | 24 | soak beans night before |

---

## Sheet 2 — Recipes (detail)

**One row per unique dish** that appears in your meal plan (plus any extras for the recipe book).

| Column | Required? | Example | Notes |
|--------|-----------|---------|-------|
| `recipe_name` | **Yes** | `Rajma Chawal` | Unique name; used to link meal plan → recipe |
| `meal_type` | Recommended | `dinner` | `breakfast`, `lunch`, `dinner`, `snack`, `side`, `drink`, `dessert` |
| `minutes` | Recommended | `45` | Active cook time |
| `marinate_hours` | Optional | `2` | If marinating ahead |
| `kcal` | Recommended | `520` | Per serving (your usual portion) |
| `protein_g` | Recommended | `24` | Per serving |
| `servings` | Optional | `2` or `3–4` | Text is fine |
| `method` | **Highly recommended** | see below | Cooking steps |
| `cook_method` | Optional | `pressure cooker` | Short tag: `oven`, `stovetop`, `air fryer`, `slow cooker`, etc. |
| `tags` | Optional | `vegetarian, meal-prep` | Comma-separated |
| `source_name` | Optional | `Ma's recipe` | Where it came from |
| `source_url` | Optional | `https://…` | Link if any |
| `image_url` | Optional | `https://…` | Photo link; leave blank if none |
| `notes` | Optional | `freezes well` | Anything else |

### How to write `method` in Excel

Pick **one** format:

1. **Numbered steps in one cell** (easiest):
   ```
   1. Soak rajma overnight | 2. Pressure cook with spices | 3. Temper and simmer | 4. Serve with rice
   ```
   Separate steps with ` | ` or newlines inside the cell.

2. **Separate columns**: `step_1`, `step_2`, `step_3`, …

3. **Separate sheet** “Method steps” with columns: `recipe_name`, `step_order`, `instruction`

### Example — Recipes rows

| recipe_name | meal_type | minutes | marinate_hours | kcal | protein_g | servings | method | cook_method |
|-------------|-----------|---------|----------------|------|-----------|----------|--------|-------------|
| Rajma Chawal | dinner | 45 | | 520 | 24 | 2 | Soak rajma 8 hr · Pressure cook · Temper onion-tomato masala · Simmer · Rice on side | cooker |
| Tandoori Chicken | dinner | 35 | 4 | 470 | 42 | 2 | Marinate in yogurt + spices · Rest 4 hr · Bake at 425°F until charred | oven |
| Jeera water | drink | 2 | | 15 | 0 | 1 | Boil water · Add cumin · Steep 5 min | stovetop |

---

## Sheet 3 — Ingredients (optional but very useful)

**One row per ingredient per recipe.** Enables shopping lists later.

| Column | Required? | Example | Notes |
|--------|-----------|---------|-------|
| `recipe_name` | **Yes** | `Rajma Chawal` | Must match Recipes sheet |
| `ingredient` | **Yes** | `Rajma (kidney beans)` | |
| `quantity` | Recommended | `1 cup dry` or `500 g` | Any units you use |
| `aisle` | Optional | `Pantry` | See aisles below |
| `note` | Optional | `soak overnight` | Prep note for this ingredient |

### Suggested aisles

`Produce` · `Meat + dairy` · `Pantry` · `Frozen` · `Bakery` · `Spices` · `Other`

### Example — Ingredients rows

| recipe_name | ingredient | quantity | aisle | note |
|-------------|------------|----------|-------|------|
| Rajma Chawal | Rajma | 1 cup dry | Pantry | soak 8 hr |
| Rajma Chawal | Basmati rice | 1 cup | Pantry | |
| Rajma Chawal | Onion | 1 large | Produce | |
| Tandoori Chicken | Chicken thighs | 1.5 lb | Meat + dairy | bone-in |
| Tandoori Chicken | Greek yogurt | 1 cup | Meat + dairy | marinade |

---

## Sheet 4 — Prep tasks (optional)

For calendar prep blocks (marinate, thaw, batch cook).

| Column | Required? | Example |
|--------|-----------|---------|
| `date` | **Yes** | `2026-08-27` |
| `time` | Optional | `16:30` or `4:30 PM` |
| `duration_min` | Optional | `15` |
| `task` | **Yes** | `Marinate chicken` |
| `linked_recipe` | Optional | `Tandoori Chicken` |
| `person` | Optional | `shreya` or `charu` |

---

## Minimum vs ideal

### Minimum (I can still import)

- **Meal plan**: date + slot + dish name (+ kcal/protein if you track them)
- **Recipes**: at least `recipe_name`; rest can be filled later in the app

### Ideal (best experience in HomeBase)

- Full **Recipes** with kcal, protein, minutes, method
- **Ingredients** sheet for shopping
- Consistent **recipe names** between meal plan and recipes
- **Prep** tasks for anything that needs advance work

---

## Naming & consistency tips

1. **Same spelling everywhere** — `Rajma Chawal` in meal plan must match `Rajma Chawal` in recipes (not `Rajma rice` in one place).
2. **List aliases** if needed:
   ```
   "Dal brown rice salad" = same as "Dal + brown rice + salad"
   ```
3. **Leftovers** — use `adhoc_name` on the meal plan row, or a simple recipe called `Leftover shawarma bowl`.
4. **Repeating items** (jeera water, daily shake) — one recipe row, reused on many days.

---

## Household-specific info (tell me in a note)

| Question | Your answer |
|----------|-------------|
| Week start date(s) to import | |
| How many weeks | |
| Charu vs Shreya — same meals or different? | |
| Calorie targets per person (if relevant) | |
| Custom meal slots beyond breakfast/lunch/dinner? | |
| Anything to **exclude** from import | |
| Replace existing seed data or **add alongside**? | |

---

## How to share

1. **Excel / Google Sheet** — attach the file or share a view link.
2. If the sheet is messy, that’s fine — send what you have and note which tab is the source of truth.
3. Optional: paste 2–3 example rows in chat if you’re unsure about format.

---

## Quick checklist before you send

- [ ] Meal plan has **dates** and **meal slots**
- [ ] Every planned dish has a matching **recipe_name** (or is marked as adhoc)
- [ ] Recipes sheet has **steps** for dinners you cook from scratch
- [ ] Ingredients sheet included (or ingredients in recipe rows)
- [ ] You noted **which week** to start on
- [ ] Aliases / naming quirks explained in a short note

Once you share the file, I’ll import recipes into the recipe book and assign meals to the correct days and slots in HomeBase.
