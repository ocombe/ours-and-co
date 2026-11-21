import type { DishWithStats, Kind, Menu, MenuItem, Wish } from './types'

/**
 * Menu generator. Pure functions: given the catalogue, the current menu items
 * and the wishes, decide which dishes to add. The rules come from the family:
 * - a dish goes to its usual moment (midi / soir, "both" fits either);
 * - weekend lunches are for 4 and need dishes the kids eat;
 * - one dish covers several meals (fewer at 4 people);
 * - wishes first, then dishes using what is in the reserve; recently eaten dishes are avoided, frequent and favourite
 *   ones come up more; at most one long dish per week; variety of categories;
 *   seasonal dishes only in their season.
 */

export type NewItem = Pick<MenuItem, 'dish_id' | 'label' | 'kind' | 'meals' | 'source'>

export function mealsFor(dish: DishWithStats, kind: Kind) {
  return kind === 'weekend' ? Math.max(1, Math.floor(dish.meals_covered / 2)) : dish.meals_covered
}

export function need(menu: Menu, kind: Kind) {
  return kind === 'midi' ? menu.need_midi : kind === 'weekend' ? menu.need_weekend : menu.need_soir
}

/** Meals of this kind covered by the menu (eaten or not). */
export function covered(items: Pick<MenuItem, 'kind' | 'meals'>[], kind: Kind) {
  return items.filter((i) => i.kind === kind).reduce((n, i) => n + i.meals, 0)
}

/** Kind a dish naturally goes to. */
export function defaultKind(dish: DishWithStats): Kind {
  return dish.usual_moment === 'midi' ? 'midi' : 'soir'
}

function inSeason(dish: DishWithStats, now: Date) {
  const m = now.getMonth() + 1
  if (dish.season === 'winter') return m >= 11 || m <= 3
  if (dish.season === 'summer') return m >= 6 && m <= 9
  return true
}

function fitsKind(dish: DishWithStats, kind: Kind) {
  if (dish.usual_moment === 'dessert') return false
  if (kind === 'soir') return dish.usual_moment === 'soir' || dish.usual_moment === 'both'
  if (kind === 'weekend' && dish.kids_ok === false) return false
  return dish.usual_moment === 'midi' || dish.usual_moment === 'both'
}

function weight(dish: DishWithStats, kind: Kind, chosen: DishWithStats[], boost?: Set<number>) {
  let w = Math.pow(1 + dish.times, 0.6)
  // Uses something we already have (freezer, pantry): strongly favoured.
  if (boost?.has(dish.id)) w *= 4
  if (dish.favorite) w *= 2
  if (dish.effort === 'long') w *= 0.35
  // Recently eaten: almost never this week, half weight two weeks ago, normal after a month.
  if (dish.weeksAgo != null) w *= Math.max(0.03, Math.min(1, dish.weeksAgo / 4))
  // Variety: each dish of the same category already in the menu halves the chance.
  const sameCat = chosen.filter((c) => c.category === dish.category).length
  w *= Math.pow(0.5, sameCat)
  // Weekend: prefer dishes we know the kids eat.
  if (kind === 'weekend' && dish.kids_ok == null) w *= 0.3
  return w
}

function pickWeighted<T>(items: T[], weights: number[], random: () => number): T | null {
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return null
  let r = random() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

interface PickContext {
  dishes: DishWithStats[]
  /** Dishes already in the menu (and any to exclude). */
  chosen: DishWithStats[]
  exclude?: Set<number>
  /** Dishes to favour (they use something from the reserve). */
  boost?: Set<number>
  now?: Date
  random?: () => number
}

/** Choose one dish for a kind of meal, following the rules. */
export function pickDish(kind: Kind, ctx: PickContext): DishWithStats | null {
  const now = ctx.now ?? new Date()
  const taken = new Set(ctx.chosen.map((d) => d.id))
  const hasLong = ctx.chosen.some((d) => d.effort === 'long')
  const candidates = ctx.dishes.filter(
    (d) =>
      !taken.has(d.id) &&
      !ctx.exclude?.has(d.id) &&
      fitsKind(d, kind) &&
      inSeason(d, now) &&
      !(hasLong && d.effort === 'long'),
  )
  return pickWeighted(
    candidates,
    candidates.map((d) => weight(d, kind, ctx.chosen, ctx.boost)),
    ctx.random ?? Math.random,
  )
}

/**
 * "Remplir": wishes first, then enough dishes to cover every meal of the week.
 * Existing items are kept. Overshooting is fine (the surplus becomes leftovers).
 */
export function fill(
  menu: Menu,
  items: MenuItem[],
  dishes: DishWithStats[],
  wishes: Wish[],
  opts: { now?: Date; random?: () => number; boost?: Set<number> } = {},
): { add: NewItem[]; usedWishes: number[] } {
  const byId = new Map(dishes.map((d) => [d.id, d]))
  const chosen = items.map((i) => (i.dish_id != null ? byId.get(i.dish_id) : undefined)).filter((d) => !!d)
  const all: Pick<MenuItem, 'kind' | 'meals'>[] = [...items]
  const add: NewItem[] = []
  const usedWishes: number[] = []

  const push = (dish: DishWithStats, kind: Kind, source: NewItem['source']) => {
    const item = { dish_id: dish.id, label: dish.name, kind, meals: mealsFor(dish, kind), source }
    add.push(item)
    all.push(item)
    chosen.push(dish)
  }

  // 1. Wishes, at their usual moment (weekend if weekday lunches are full and the kids eat it).
  for (const w of wishes) {
    const dish = byId.get(w.dish_id)
    usedWishes.push(w.id)
    if (!dish || chosen.some((c) => c.id === dish.id)) continue
    let kind = defaultKind(dish)
    if (kind === 'midi' && covered(all, 'midi') >= menu.need_midi && dish.kids_ok && covered(all, 'weekend') < menu.need_weekend) {
      kind = 'weekend'
    }
    push(dish, kind, 'wish')
  }

  // 2. Fill each kind until covered. Weekend first: it has the strictest rule.
  for (const kind of ['weekend', 'midi', 'soir'] as Kind[]) {
    let guard = 30
    while (covered(all, kind) < need(menu, kind) && guard-- > 0) {
      const dish = pickDish(kind, { dishes, chosen, boost: opts.boost, now: opts.now, random: opts.random })
      if (!dish) break
      push(dish, kind, 'generated')
    }
  }

  return { add, usedWishes }
}

/** "Remplacer": another dish for the same kind of meal. */
export function replacement(
  item: MenuItem,
  items: MenuItem[],
  dishes: DishWithStats[],
  opts: { now?: Date; random?: () => number; boost?: Set<number> } = {},
): DishWithStats | null {
  const byId = new Map(dishes.map((d) => [d.id, d]))
  const chosen = items
    .filter((i) => i.id !== item.id)
    .map((i) => (i.dish_id != null ? byId.get(i.dish_id) : undefined))
    .filter((d) => !!d)
  const exclude = new Set(item.dish_id != null ? [item.dish_id] : [])
  return pickDish(item.kind, { dishes, chosen, exclude, boost: opts.boost, now: opts.now, random: opts.random })
}

/** The Saturday a new menu starts on: today if Saturday, else the next one. */
export function nextSaturday(from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7))
  return d
}

export function isoDate(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
