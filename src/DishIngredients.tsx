import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { SuggestInput } from './SuggestInput'
import { fold } from './text'
import type { Ingredient, ShoppingList } from './types'

interface Row {
  ingredient_id: number
  quantity: number | null
  unit: string | null
  ingredients: Ingredient
}

/** Ingredients of one dish (quantities for 2 people) with each one's usual store. */
export function DishIngredients({ dishId }: { dishId: number }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [all, setAll] = useState<Ingredient[]>([])
  const [stores, setStores] = useState<ShoppingList[]>([])
  const [name, setName] = useState('')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [r, i, l] = await Promise.all([
      supabase.from('dish_ingredients').select('ingredient_id, quantity, unit, ingredients(id, name, store)').eq('dish_id', dishId),
      supabase.from('ingredients').select('id, name, store').order('name'),
      supabase.from('lists').select('*').order('position'),
    ])
    const err = r.error ?? i.error ?? l.error
    if (err) return setError(err.message)
    setRows(r.data as unknown as Row[])
    setAll(i.data as Ingredient[])
    setStores(l.data as ShoppingList[])
  }, [dishId])

  useEffect(() => {
    load()
  }, [load])

  async function add() {
    const n = name.trim()
    if (!n) return
    setError('')
    let ing = all.find((a) => fold(a.name) === fold(n))
    if (!ing) {
      const created = await supabase.from('ingredients').insert({ name: n }).select('id, name, store').single()
      if (created.error) return setError(created.error.message)
      ing = created.data as Ingredient
    }
    const q = qty.trim() ? Number(qty.replace(',', '.')) : null
    const { error } = await supabase.from('dish_ingredients').insert({
      dish_id: dishId,
      ingredient_id: ing.id,
      quantity: q && q > 0 ? q : null,
      unit: unit.trim() || null,
    })
    if (error) return setError(error.code === '23505' ? `${ing.name} est déjà dans la liste.` : error.message)
    setName('')
    setQty('')
    setUnit('')
    load()
  }

  async function remove(ingredientId: number) {
    const { error } = await supabase.from('dish_ingredients').delete().eq('dish_id', dishId).eq('ingredient_id', ingredientId)
    if (error) setError(error.message)
    load()
  }

  async function setStore(ingredientId: number, store: string) {
    const { error } = await supabase.from('ingredients').update({ store: store || null }).eq('id', ingredientId)
    if (error) setError(error.message)
    load()
  }

  return (
    <fieldset className="field">
      <legend>Ingrédients (pour 2)</legend>
      {rows && rows.length === 0 && <p className="muted small">Pas encore d’ingrédients.</p>}
      {rows && rows.length > 0 && (
        <ul className="ingredient-list">
          {rows.map((r) => (
            <li key={r.ingredient_id}>
              <span className="ing-name">
                {r.ingredients.name}
                {r.quantity != null && <span className="muted"> {String(r.quantity).replace('.', ',')}{r.unit ? ' ' + r.unit : ''}</span>}
              </span>
              <select
                aria-label={`Magasin pour ${r.ingredients.name}`}
                value={r.ingredients.store ?? ''}
                onChange={(e) => setStore(r.ingredient_id, e.target.value)}
              >
                <option value="">Magasin ?</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button type="button" className="icon-btn" aria-label={`Retirer ${r.ingredients.name}`} onClick={() => remove(r.ingredient_id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="add-row ing-add">
        <SuggestInput
          aria-label="Ingrédient"
          placeholder="Ingrédient"
          value={name}
          onChange={setName}
          options={all.map((a) => a.name)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <input className="qty" inputMode="decimal" aria-label="Quantité" placeholder="Qté" value={qty} onChange={(e) => setQty(e.target.value)} />
        <input className="qty" aria-label="Unité" placeholder="g, cl…" value={unit} onChange={(e) => setUnit(e.target.value)} />
        <button type="button" className="btn ghost small" onClick={add}>
          Ajouter
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </fieldset>
  )
}
