# Ours & Co

Family PWA for meals, shopping lists and pantry/freezer stock. UI and data are in French.

- App: Vite + React + TypeScript, PWA (vite-plugin-pwa), deployed to GitHub Pages
  (`https://ocombe.github.io/ours-and-co/`) by `.github/workflows/deploy.yml` on push to `main`.
- Data: Supabase project `ours-and-co` (ref `xeobqdfkjbtclosrfhmi`, eu-west-3).
  Schema changes live in `supabase/migrations/`; apply them with the Supabase MCP `apply_migration`.
- Local spec and raw data (`SPEC.md`, `data/`) are git-ignored on purpose: the repo is public.

## Reading and changing data from a chat

Use the Supabase connector (`execute_sql`) on project `xeobqdfkjbtclosrfhmi`.
Prefer the helper functions in the `claude` schema over raw writes:

```sql
-- Search dishes by name, old FamilyWall spellings or ingredient (fuzzy: typos and accents forgiven, best first)
select id, name, category, usual_moment, meals_covered from claude.find_dishes('courge');

-- Add a wish for the next menu (dish name, accent/case-insensitive; must match one dish)
select * from claude.add_wish('Raclette', 'envie de fromage');

-- Add a dish to the current (latest) menu; kind = 'midi' | 'weekend' | 'soir' | 'kids' (default from the dish)
select * from claude.add_to_menu('Poulet rôti', 'weekend');

-- Add to a shopping list by list name (Marché, Carrefour, Picard, Courses, Pharmacie, Vrac, Bricolage, Ikea); quantity and note optional
select * from claude.add_to_list('Marché', 'Poireaux', '3', 'pour la soupe');

-- Add to the reserve (location: congélateur, frigo or placard)
select * from claude.add_to_reserve('Magrets de canard', '2', 'congélateur');

-- Add a dish (fails if the name already exists)
select * from claude.add_dish(
  p_name => 'Curry de potimarron', p_category => 'végétarien',
  p_usual_moment => 'soir', p_meals_covered => 2, p_kids_ok => null,
  p_season => 'winter', p_notes => 'Recette : …', p_link => null);
```

Tables (all in `public`, protected by RLS for household members; Claude runs as `postgres`):

| Table | What |
|---|---|
| `dishes` | the catalogue. `usual_moment`: midi / soir / both / dessert (a preference, not a rule). `meals_covered`: how many meals one batch covers for 2 people. `effort`: quick / normal / long. `kids_ok`: null = unknown. `kids_only`: only for the girls (e.g. cordons bleus), not counted in the week's meals. `to_review`: imported guess, to check. `aliases`: old FamilyWall names. |
| `ingredients`, `dish_ingredients` | products with preferred `store` (a list name) and `aisle`; dish quantities are for 2 people |
| `history` | meals eaten. FamilyWall imports have `eaten_on` null and `legacy_rank` (higher = more recent) |
| `menus` | one per week, `starts_on` = Saturday; `need_midi` / `need_weekend` / `need_soir` = meals to cover |
| `menu_items` | dishes of a menu: `kind` midi/weekend/soir/kids (kids = for the girls, not counted in the needs), `meals` covered, `eaten` parts; `source` generated/manual/wish/leftover |
| `wishes` | dishes to put first in the next menu |
| `lists`, `list_items` | shopping lists and their items (`aisle` = rayon, `menu_id` set when filled from a menu, `note` = free note, `added_by` = member who added it, null when added by Claude, `updated_at` = last change, shown in the app) |
| `reserve_items` | what we already have (freezer, fridge, pantry); kept off shopping lists, favoured by the generator |
| `members` | household accounts allowed to use the app (`avatar_url` = Google photo, `lists_seen_at` = last visit to the lists, for the "nouveau" badges) |

## Household rules (for suggestions and menus)

- 2 people per meal; weekend lunches are for 4 (with the kids) and need `kids_ok` dishes.
- Some dishes are only for the girls (`kids_only`): they go to the "Pour les filles" part and do not count.
- Meat dishes are usually lunch; quiches, salmon dishes, croque monsieur, caillettes, saucisson brioché are usually dinner.
- One dish can cover several meals (quiche = 2 dinners, roast chicken = 3 lunches).
- Long dishes (couscous, paella…) are rare: at most one per week.
- Generated menus have at most one dish per meat or fish (volaille, porc, boeuf, veau/agneau, poisson): no two chicken or fish dishes. Pasta, soup… may repeat. Dishes added by hand are never refused.
- Shopping: market on Saturday morning, Carrefour on Wednesday morning.
- "Fushis" = home-made "faux sushis" (raw salmon on rice), not fusilli.
- Steaks and steaks hachés are different dishes.

Before adding a dish, search for it first to avoid duplicates. Confirm with the user before deleting anything.
