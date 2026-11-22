import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { useDishes } from './data'
import { COUNTED_KINDS, covered, fill, isoDate, mealsFor, need, nextSaturday, replacement } from './generator'
import { longDate } from './text'
import { DishPicker } from './DishPicker'
import { ChooseSheet } from './ChooseSheet'
import { DishSheet } from './DishSheet'
import { dishesUsingReserve, fillShopping } from './shopping'
import { KIND_LABEL, type DishWithStats, type Kind, type Menu, type MenuItem, type Wish } from './types'

const NEED_FIELD: Record<Exclude<Kind, 'kids'>, keyof Menu> = { midi: 'need_midi', weekend: 'need_weekend', soir: 'need_soir' }
const SOURCE_TAG: Partial<Record<MenuItem['source'], string>> = { leftover: 'reste', wish: 'envie' }

export function MenuScreen() {
  const { dishes, reload: reloadDishes } = useDishes()
  const [editing, setEditing] = useState<DishWithStats | null>(null)
  const [menu, setMenu] = useState<Menu | null | undefined>(undefined)
  const [items, setItems] = useState<MenuItem[]>([])
  const [wishes, setWishes] = useState<Wish[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [picker, setPicker] = useState<'menu' | 'wish' | 'choose' | null>(null)
  const [shopMsg, setShopMsg] = useState('')

  const load = useCallback(async () => {
    const [m, w] = await Promise.all([
      supabase.from('menus').select('*').order('starts_on', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('wishes').select('*').order('created_at'),
    ])
    if (m.error || w.error) return setError((m.error ?? w.error)!.message)
    setWishes(w.data as Wish[])
    setMenu(m.data as Menu | null)
    if (m.data) {
      const it = await supabase.from('menu_items').select('*').eq('menu_id', m.data.id).order('created_at')
      if (it.error) return setError(it.error.message)
      setItems(it.data as MenuItem[])
    } else {
      setItems([])
    }
  }, [])

  useEffect(() => {
    load()
    // Live: what one phone changes shows on the other.
    const channel = supabase
      .channel('menu')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menus' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wishes' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  /** Run a change, show its error if any, then reload. */
  async function run(action: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true)
    setError('')
    const { error } = await action()
    if (error) setError(error.message)
    await load()
    setBusy(false)
  }

  const dishById = useMemo(() => new Map((dishes ?? []).map((d) => [d.id, d])), [dishes])

  async function newWeek() {
    const startsOn = menu
      ? isoDate(new Date(new Date(menu.starts_on + 'T12:00:00').getTime() + 7 * 86400000))
      : isoDate(nextSaturday())
    await run(async () => {
      const created = await supabase
        .from('menus')
        .insert(menu ? { starts_on: startsOn, need_midi: menu.need_midi, need_weekend: menu.need_weekend, need_soir: menu.need_soir } : { starts_on: startsOn })
        .select()
        .single()
      if (created.error) return created
      // Whatever was not eaten carries over as leftovers.
      const leftovers = items
        .filter((i) => i.eaten < i.meals)
        .map((i) => ({
          menu_id: created.data.id,
          dish_id: i.dish_id,
          label: i.label,
          kind: i.kind,
          meals: i.meals - i.eaten,
          source: 'leftover' as const,
        }))
      return leftovers.length ? supabase.from('menu_items').insert(leftovers) : { error: null }
    })
  }

  async function setNeed(kind: Kind, value: number) {
    if (!menu || kind === 'kids') return
    await run(() => supabase.from('menus').update({ [NEED_FIELD[kind]]: value }).eq('id', menu.id))
  }

  async function fillMenu() {
    if (!menu || !dishes) return
    const boost = await dishesUsingReserve()
    const { add, usedWishes } = fill(menu, items, dishes, wishes, { boost })
    await run(async () => {
      if (add.length) {
        const r = await supabase.from('menu_items').insert(add.map((a) => ({ ...a, menu_id: menu.id })))
        if (r.error) return r
      }
      return usedWishes.length ? supabase.from('wishes').delete().in('id', usedWishes) : { error: null }
    })
  }

  /** Add one dish to the menu (from a wish: the wish is used up). */
  async function addItem(dish: DishWithStats, kind: Kind, source: MenuItem['source'], wish?: Wish) {
    if (!menu) return
    await run(async () => {
      const r = await supabase
        .from('menu_items')
        .insert({ menu_id: menu.id, dish_id: dish.id, label: dish.name, kind, meals: mealsFor(dish, kind), source })
      if (r.error || !wish) return r
      return supabase.from('wishes').delete().eq('id', wish.id)
    })
  }

  async function replace(item: MenuItem) {
    if (!dishes) return
    const dish = replacement(item, items, dishes, { boost: await dishesUsingReserve() })
    if (!dish) return setError('Aucun autre plat ne respecte les règles pour ce repas.')
    await run(() =>
      supabase
        .from('menu_items')
        .update({ dish_id: dish.id, label: dish.name, meals: mealsFor(dish, item.kind), source: 'generated', eaten: 0 })
        .eq('id', item.id),
    )
  }

  async function toShopping() {
    if (!menu) return
    setBusy(true)
    setError('')
    setShopMsg('')
    try {
      const r = await fillShopping(menu, items)
      const parts = [
        r.added ? `${r.added} ingrédient${r.added > 1 ? 's' : ''} ajouté${r.added > 1 ? 's' : ''} aux courses.` : 'Aucun ingrédient à ajouter.',
      ]
      if (r.inReserve.length) parts.push(`Déjà en réserve : ${r.inReserve.join(', ')}.`)
      if (r.dishesWithoutIngredients.length)
        parts.push(`Sans ingrédients renseignés : ${r.dishesWithoutIngredients.join(', ')}.`)
      setShopMsg(parts.join(' '))
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  async function toggleEaten(item: MenuItem, part: number) {
    if (part < item.eaten) {
      // Un-eat the last part: remove its history row.
      await run(async () => {
        const last = await supabase
          .from('history')
          .select('id')
          .eq('menu_item_id', item.id)
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (last.data) await supabase.from('history').delete().eq('id', last.data.id)
        return supabase.from('menu_items').update({ eaten: item.eaten - 1 }).eq('id', item.id)
      })
    } else {
      await run(async () => {
        const h = await supabase.from('history').insert({
          dish_id: item.dish_id,
          label: item.label,
          eaten_on: isoDate(new Date()),
          moment:
            item.kind === 'soir' || (item.kind === 'kids' && dishById.get(item.dish_id ?? -1)?.usual_moment !== 'midi')
              ? 'soir'
              : 'midi',
          people: item.kind === 'weekend' ? 4 : 2,
          menu_item_id: item.id,
        })
        if (h.error) return h
        return supabase.from('menu_items').update({ eaten: item.eaten + 1 }).eq('id', item.id)
      })
    }
  }

  if (menu === undefined) return <main className="screen"><p className="muted">Chargement…</p></main>

  if (menu === null) {
    return (
      <main className="screen">
        <h1>Menu</h1>
        <div className="empty">
          <p>Pas encore de menu. On prépare la semaine qui commence samedi {longDate(isoDate(nextSaturday())).replace(/^samedi /, '')} ?</p>
          <button className="btn honey" disabled={busy} onClick={newWeek}>
            Préparer la semaine
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </main>
    )
  }

  const totalMissing = COUNTED_KINDS.reduce((n, k) => n + Math.max(0, need(menu, k) - covered(items, k)), 0)

  return (
    <main className="screen">
      <div className="screen-head">
        <div>
          <h1>Menu</h1>
          <p className="muted small">Semaine du {longDate(menu.starts_on)}</p>
        </div>
        <button className="btn ghost small" disabled={busy} onClick={newWeek}>
          Semaine suivante
        </button>
      </div>

      <section className="wishes" aria-labelledby="wishes-title">
        <div className="row-between">
          <h2 id="wishes-title">Envies</h2>
          <button className="btn ghost small" onClick={() => setPicker('wish')}>
            Ajouter une envie
          </button>
        </div>
        {wishes.length === 0 ? (
          <p className="muted small">Un plat en promo, une envie ? Il passera en premier quand tu rempliras le menu.</p>
        ) : (
          <ul className="wish-list">
            {wishes.map((w) => (
              <li key={w.id}>
                {dishById.get(w.dish_id)?.name ?? '…'}
                <button
                  className="icon-btn"
                  aria-label={`Retirer l’envie ${dishById.get(w.dish_id)?.name ?? ''}`}
                  onClick={() => run(() => supabase.from('wishes').delete().eq('id', w.id))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="actions-bar">
        <button className="btn honey" disabled={busy || !dishes || (totalMissing === 0 && wishes.length === 0)} onClick={fillMenu}>
          {totalMissing > 0 ? `Tout remplir (${totalMissing} repas)` : wishes.length ? 'Ajouter les envies' : 'Tout est prévu'}
        </button>
        <button className="btn ghost choose" disabled={!dishes} onClick={() => setPicker('choose')}>
          Choisir un par un
        </button>
        <button className="btn ghost" disabled={!dishes} onClick={() => setPicker('menu')}>
          Ajouter un plat
        </button>
        <button className="btn ghost" disabled={busy || items.length === 0} onClick={toShopping}>
          Mettre dans les courses
        </button>
      </div>
      {shopMsg && <p className="notice-text">{shopMsg}</p>}

      {error && <p className="error">{error}</p>}

      {[...COUNTED_KINDS, 'kids' as const].map((kind) => {
        const list = items.filter((i) => i.kind === kind)
        if (kind === 'kids' && list.length === 0) return null
        const have = covered(items, kind)
        const want = need(menu, kind)
        return (
          <section key={kind} className="group" aria-labelledby={`k-${kind}`}>
            <div className="row-between">
              <h2 id={`k-${kind}`}>{KIND_LABEL[kind]}</h2>
              {kind !== 'kids' && (
                <div className="need" role="group" aria-label={`Repas à prévoir : ${KIND_LABEL[kind]}`}>
                  <span className={have >= want ? 'ok' : ''}>
                    {have}/{want}
                  </span>
                  <button className="icon-btn" aria-label="Un repas de moins" disabled={busy || want <= 0} onClick={() => setNeed(kind, want - 1)}>
                    −
                  </button>
                  <button className="icon-btn" aria-label="Un repas de plus" disabled={busy} onClick={() => setNeed(kind, want + 1)}>
                    +
                  </button>
                </div>
              )}
            </div>
            {kind !== 'kids' && have > want && (
              <p className="muted small">
                {have - want} repas en trop : ils passeront en reste la semaine suivante s’ils ne sont pas mangés.
              </p>
            )}
            {list.length === 0 ? (
              <p className="muted small">Rien de prévu.</p>
            ) : (
              <ul className="dish-list">
                {list.map((it) => (
                  <li key={it.id} className="menu-item">
                    <div className="menu-item-main">
                      {dishById.get(it.dish_id ?? -1) ? (
                        // The dish itself (not the menu's copy of its name): open its sheet to read or edit it.
                        <button
                          className={'dish-name link' + (it.eaten >= it.meals ? ' done' : '')}
                          onClick={() => setEditing(dishById.get(it.dish_id!)!)}
                        >
                          {dishById.get(it.dish_id!)!.name}
                        </button>
                      ) : (
                        <span className={'dish-name' + (it.eaten >= it.meals ? ' done' : '')}>{it.label}</span>
                      )}
                      <span className="dish-meta">
                        {SOURCE_TAG[it.source] && <span className="tag">{SOURCE_TAG[it.source]}</span>}
                        {it.meals > 1 && <span className="muted">{it.meals} repas</span>}
                      </span>
                    </div>
                    <div className="parts" role="group" aria-label={`Repas mangés : ${it.eaten} sur ${it.meals}`}>
                      {Array.from({ length: it.meals }, (_, p) => (
                        <button
                          key={p}
                          className={'part' + (p < it.eaten ? ' on' : '')}
                          aria-pressed={p < it.eaten}
                          aria-label={p < it.eaten ? `Repas ${p + 1} mangé, annuler` : `Marquer le repas ${p + 1} comme mangé`}
                          disabled={busy}
                          onClick={() => toggleEaten(it, p)}
                        >
                          {p < it.eaten ? '✓' : ''}
                        </button>
                      ))}
                    </div>
                    <div className="item-actions">
                      {it.eaten === 0 && (
                        <button className="btn ghost small" disabled={busy || !dishes} onClick={() => replace(it)}>
                          Remplacer
                        </button>
                      )}
                      <button
                        className="btn ghost small"
                        disabled={busy}
                        onClick={() => run(() => supabase.from('menu_items').delete().eq('id', it.id))}
                      >
                        Retirer
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}

      {editing && (
        <DishSheet
          dish={editing}
          initialName=""
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reloadDishes()
          }}
        />
      )}

      {picker === 'choose' && dishes && (
        <ChooseSheet
          menu={menu}
          items={items}
          dishes={dishes}
          wishes={wishes}
          onPick={(dish, kind, wish) => addItem(dish, kind, wish ? 'wish' : 'generated', wish)}
          onClose={() => setPicker(null)}
        />
      )}

      {(picker === 'menu' || picker === 'wish') && dishes && (
        <DishPicker
          title={picker === 'menu' ? 'Ajouter un plat au menu' : 'Ajouter une envie'}
          dishes={dishes}
          withKind={picker === 'menu'}
          confirmLabel="Ajouter au menu"
          onClose={() => setPicker(null)}
          onPick={(dish, kind) => {
            setPicker(null)
            if (picker === 'menu') addItem(dish, kind, 'manual')
            else run(() => supabase.from('wishes').insert({ dish_id: dish.id }))
          }}
        />
      )}
    </main>
  )
}
