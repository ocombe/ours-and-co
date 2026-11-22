import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { useDishes } from './data'
import { applyChange, coalesce, listen, sortBy, upsert, type Change } from './live'
import { COUNTED_KINDS, covered, fill, isoDate, mealsFor, need, nextSaturday, replacement } from './generator'
import { longDate } from './text'
import { DishPicker } from './DishPicker'
import { ChooseSheet } from './ChooseSheet'
import { DishSheet } from './DishSheet'
import { dishesUsingReserve, fillShopping } from './shopping'
import { KIND_LABEL, type DishWithStats, type Kind, type Menu, type MenuItem, type Wish } from './types'

const NEED_FIELD: Record<Exclude<Kind, 'kids'>, keyof Menu> = { midi: 'need_midi', weekend: 'need_weekend', soir: 'need_soir' }
const SOURCE_TAG: Partial<Record<MenuItem['source'], string>> = { leftover: 'reste', wish: 'envie' }

type Result = PromiseLike<{ error: { message: string } | null }>

export function MenuScreen() {
  const { dishes, ate } = useDishes()
  const [editing, setEditing] = useState<DishWithStats | null>(null)
  const [menu, setMenu] = useState<Menu | null | undefined>(undefined)
  const [items, setItems] = useState<MenuItem[]>([])
  const [wishes, setWishes] = useState<Wish[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [picker, setPicker] = useState<'menu' | 'wish' | 'choose' | null>(null)
  const [shopMsg, setShopMsg] = useState('')
  const menuRef = useRef(menu)
  menuRef.current = menu

  /** The latest menu with its dishes, in one request. */
  const loadMenu = useCallback(async () => {
    const m = await supabase
      .from('menus')
      .select('*, menu_items(*)')
      .order('starts_on', { ascending: false })
      .order('id', { referencedTable: 'menu_items' })
      .limit(1)
      .maybeSingle()
    if (m.error) return setError(m.error.message)
    const { menu_items, ...rest } = (m.data ?? { menu_items: [] }) as Menu & { menu_items: MenuItem[] }
    setMenu(m.data ? (rest as Menu) : null)
    setItems(menu_items)
  }, [])

  const loadWishes = useCallback(async () => {
    const w = await supabase.from('wishes').select('*').order('id')
    if (w.error) return setError(w.error.message)
    setWishes(w.data as Wish[])
  }, [])

  useEffect(() => {
    loadMenu()
    loadWishes()
    const reloadMenu = coalesce(loadMenu)
    // Live: changes (this phone, the other one, Claude) are applied from the event itself.
    return listen(
      'menu',
      [
        {
          table: 'menu_items',
          on: (c) => setItems((cur) => sortBy(applyChange(cur, c as Change<MenuItem>, (r) => r.menu_id === menuRef.current?.id), 'id')),
        },
        {
          table: 'menus',
          on: (c) => {
            const row = (c as Change<Menu>).new as Menu
            if (c.eventType === 'UPDATE' && row.id === menuRef.current?.id) setMenu(row)
            else reloadMenu() // a new week (or a deleted one): load it with its dishes
          },
        },
        { table: 'wishes', on: (c) => setWishes((cur) => sortBy(applyChange(cur, c as Change<Wish>), 'id')) },
      ],
      () => {
        reloadMenu()
        loadWishes()
      },
    )
  }, [loadMenu, loadWishes])

  /** Show menu items right away (they come back from the insert / update / RPC). */
  function putItems(rows: MenuItem | MenuItem[] | null) {
    if (rows) setItems((cur) => sortBy(upsert(cur, rows, (r) => r.menu_id === menuRef.current?.id), 'id'))
  }

  /** Run a change; on error show it and reload what is on screen from the server. */
  async function run(action: () => Result) {
    setBusy(true)
    setError('')
    const { error } = await action()
    if (error) {
      setError(error.message)
      await Promise.all([loadMenu(), loadWishes()])
    }
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
      const r = leftovers.length ? await supabase.from('menu_items').insert(leftovers).select() : { data: [], error: null }
      menuRef.current = created.data as Menu
      setMenu(created.data as Menu)
      setItems(sortBy((r.data ?? []) as MenuItem[], 'id'))
      return r
    })
  }

  async function setNeed(kind: Kind, value: number) {
    if (!menu || kind === 'kids') return
    setMenu({ ...menu, [NEED_FIELD[kind]]: value })
    await run(() => supabase.from('menus').update({ [NEED_FIELD[kind]]: value }).eq('id', menu.id))
  }

  async function fillMenu() {
    if (!menu || !dishes) return
    const boost = await dishesUsingReserve()
    const { add, usedWishes } = fill(menu, items, dishes, wishes, { boost })
    await run(async () => {
      if (add.length) {
        const r = await supabase.from('menu_items').insert(add.map((a) => ({ ...a, menu_id: menu.id }))).select()
        if (r.error) return r
        putItems(r.data as MenuItem[])
      }
      if (!usedWishes.length) return { error: null }
      setWishes((cur) => cur.filter((w) => !usedWishes.includes(w.id)))
      return supabase.from('wishes').delete().in('id', usedWishes)
    })
  }

  /** Add one dish to the menu (from a wish: the wish is used up). */
  async function addItem(dish: DishWithStats, kind: Kind, source: MenuItem['source'], wish?: Wish) {
    if (!menu) return
    await run(async () => {
      const r = await supabase
        .from('menu_items')
        .insert({ menu_id: menu.id, dish_id: dish.id, label: dish.name, kind, meals: mealsFor(dish, kind), source })
        .select()
        .single()
      if (r.error) return r
      putItems(r.data as MenuItem)
      if (!wish) return r
      setWishes((cur) => cur.filter((w) => w.id !== wish.id))
      return supabase.from('wishes').delete().eq('id', wish.id)
    })
  }

  async function addWish(dishId: number) {
    await run(async () => {
      const r = await supabase.from('wishes').insert({ dish_id: dishId }).select().single()
      if (r.data) setWishes((cur) => sortBy(upsert(cur, r.data as Wish), 'id'))
      return r
    })
  }

  async function removeWish(id: number) {
    setWishes((cur) => cur.filter((w) => w.id !== id))
    await run(() => supabase.from('wishes').delete().eq('id', id))
  }

  async function removeItem(id: number) {
    setItems((cur) => cur.filter((i) => i.id !== id))
    await run(() => supabase.from('menu_items').delete().eq('id', id))
  }

  async function replace(item: MenuItem) {
    if (!dishes) return
    const dish = replacement(item, items, dishes, { boost: await dishesUsingReserve() })
    if (!dish) return setError('Aucun autre plat ne respecte les règles pour ce repas.')
    await run(async () => {
      const r = await supabase
        .from('menu_items')
        .update({ dish_id: dish.id, label: dish.name, meals: mealsFor(dish, item.kind), source: 'generated', eaten: 0 })
        .eq('id', item.id)
        .select()
        .single()
      putItems(r.data as MenuItem | null)
      return r
    })
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

  /** Tick or untick one part: one call (history and counter change together in the database). */
  async function toggleEaten(item: MenuItem, part: number) {
    const eat = part >= item.eaten
    await run(async () => {
      const r = eat
        ? await supabase.rpc('eat_part', { p_item: item.id, p_on: isoDate(new Date()) })
        : await supabase.rpc('uneat_part', { p_item: item.id })
      if (r.error) return r
      putItems(r.data as MenuItem)
      if (item.dish_id != null) ate(item.dish_id, eat ? 1 : -1)
      return r
    })
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
                  onClick={() => removeWish(w.id)}
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
                        onClick={() => removeItem(it.id)}
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
          // The saved dish comes back through the live sync: nothing to reload.
          onSaved={() => setEditing(null)}
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
            else addWish(dish.id)
          }}
        />
      )}
    </main>
  )
}
