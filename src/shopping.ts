import { supabase } from './supabase'
import { fold } from './text'
import { guessAisle } from './aisles'
import type { Menu, MenuItem } from './types'

interface DishIngredientRow {
  dish_id: number
  quantity: number | null
  unit: string | null
  ingredients: { id: number; name: string; store: string | null; aisle: string | null }
}

export interface ShoppingResult {
  added: number
  /** Products added per list name. */
  perList: [string, number][]
  inReserve: string[]
  /** Already bought for this menu (ticked earlier): not added again. */
  bought: string[]
  dishesWithoutIngredients: { id: number; name: string }[]
}

const FALLBACK_LIST = 'Courses'

function formatQty(parts: Map<string, number>, unknown: boolean) {
  const out = [...parts].map(([unit, q]) => `${String(Math.round(q * 100) / 100).replace('.', ',')}${unit ? ' ' + unit : ''}`)
  if (unknown && out.length === 0) return null
  return out.join(' + ') || null
}

/**
 * Puts the ingredients of the menu's dishes in the shopping lists:
 * summed per ingredient, minus what is in the reserve, each in its usual
 * store's list. Re-running replaces what a previous run added and that
 * hasn't been bought yet, and skips what was already bought for this menu.
 * Leftovers and eaten dishes are skipped.
 */
export async function fillShopping(menu: Menu, items: MenuItem[]): Promise<ShoppingResult> {
  const toCook = items.filter((i) => i.dish_id != null && i.source !== 'leftover' && i.eaten < i.meals)
  const dishIds = [...new Set(toCook.map((i) => i.dish_id!))]

  const [di, reserve, lists, boughtRows] = await Promise.all([
    dishIds.length
      ? supabase.from('dish_ingredients').select('dish_id, quantity, unit, ingredients(id, name, store, aisle)').in('dish_id', dishIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('reserve_items').select('label, ingredient_id'),
    supabase.from('lists').select('id, name'),
    supabase.from('list_items').select('ingredient_id').eq('menu_id', menu.id).eq('done', true),
  ])
  const err = di.error ?? reserve.error ?? lists.error ?? boughtRows.error
  if (err) throw new Error(err.message)

  const rows = di.data as unknown as DishIngredientRow[]
  const boughtIds = new Set(boughtRows.data!.map((r) => r.ingredient_id).filter((x) => x != null))
  const reserveIds = new Set(reserve.data!.map((r) => r.ingredient_id).filter((x) => x != null))
  const reserveLabels = new Set(reserve.data!.map((r) => fold(r.label)))
  const listByName = new Map(lists.data!.map((l) => [fold(l.name), l.id]))
  const fallback = listByName.get(fold(FALLBACK_LIST)) ?? lists.data![0]?.id

  // Sum quantities per ingredient (weekend lunches are cooked for 4: twice the recipe).
  const need = new Map<number, { name: string; store: string | null; aisle: string | null; parts: Map<string, number>; unknown: boolean }>()
  for (const item of toCook) {
    const factor = item.kind === 'weekend' ? 2 : 1
    for (const r of rows.filter((x) => x.dish_id === item.dish_id)) {
      const ing = r.ingredients
      const n = need.get(ing.id) ?? { name: ing.name, store: ing.store, aisle: ing.aisle, parts: new Map(), unknown: false }
      if (r.quantity != null) {
        const unit = r.unit ?? ''
        n.parts.set(unit, (n.parts.get(unit) ?? 0) + r.quantity * factor)
      } else {
        n.unknown = true
      }
      need.set(ing.id, n)
    }
  }

  const inReserve: string[] = []
  const bought: string[] = []
  const rowsToInsert = []
  for (const [id, n] of need) {
    if (reserveIds.has(id) || reserveLabels.has(fold(n.name))) {
      inReserve.push(n.name)
      continue
    }
    if (boughtIds.has(id)) {
      bought.push(n.name)
      continue
    }
    rowsToInsert.push({
      list_id: (n.store && listByName.get(fold(n.store))) || fallback,
      label: n.name,
      quantity: formatQty(n.parts, n.unknown),
      ingredient_id: id,
      menu_id: menu.id,
      aisle: n.aisle ?? guessAisle(n.name),
    })
  }

  // Replace the previous, not yet bought, items added from this menu.
  const del = await supabase.from('list_items').delete().eq('menu_id', menu.id).eq('done', false)
  if (del.error) throw new Error(del.error.message)
  if (rowsToInsert.length) {
    const ins = await supabase.from('list_items').insert(rowsToInsert)
    if (ins.error) throw new Error(ins.error.message)
  }

  const withIngredients = new Set(rows.map((r) => r.dish_id))
  const nameOf = new Map(lists.data!.map((l) => [l.id, l.name as string]))
  const perList = new Map<string, number>()
  for (const r of rowsToInsert) {
    const name = nameOf.get(r.list_id) ?? '?'
    perList.set(name, (perList.get(name) ?? 0) + 1)
  }
  const without = new Map(toCook.filter((i) => !withIngredients.has(i.dish_id!)).map((i) => [i.dish_id!, i.label]))
  return {
    added: rowsToInsert.length,
    perList: [...perList],
    inReserve,
    bought,
    dishesWithoutIngredients: [...without].map(([id, name]) => ({ id, name })),
  }
}

/** Dishes using something from the reserve: the generator favours them. */
export async function dishesUsingReserve(): Promise<Set<number>> {
  const [reserve, di] = await Promise.all([
    supabase.from('reserve_items').select('label, ingredient_id'),
    supabase.from('dish_ingredients').select('dish_id, ingredient_id, ingredients(name)'),
  ])
  if (reserve.error || di.error) return new Set()
  const ids = new Set(reserve.data.map((r) => r.ingredient_id).filter((x) => x != null))
  const labels = new Set(reserve.data.map((r) => fold(r.label)))
  return new Set(
    (di.data as unknown as { dish_id: number; ingredient_id: number; ingredients: { name: string } }[])
      .filter((r) => ids.has(r.ingredient_id) || labels.has(fold(r.ingredients.name)))
      .map((r) => r.dish_id),
  )
}
