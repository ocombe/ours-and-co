import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { useDishes } from './data'
import { covered, fill, isoDate, mealsFor, need, nextSaturday, replacement } from './generator'
import { longDate } from './text'
import { DishPicker } from './DishPicker'
import { KIND_LABEL, type Kind, type Menu, type MenuItem, type Wish } from './types'

const KINDS: Kind[] = ['weekend', 'midi', 'soir']
const NEED_FIELD: Record<Kind, keyof Menu> = { midi: 'need_midi', weekend: 'need_weekend', soir: 'need_soir' }
const SOURCE_TAG: Partial<Record<MenuItem['source'], string>> = { leftover: 'reste', wish: 'envie' }

export function MenuScreen() {
  const { dishes } = useDishes()
  const [menu, setMenu] = useState<Menu | null | undefined>(undefined)
  const [items, setItems] = useState<MenuItem[]>([])
  const [wishes, setWishes] = useState<Wish[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [picker, setPicker] = useState<'menu' | 'wish' | null>(null)

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
    if (!menu) return
    await run(() => supabase.from('menus').update({ [NEED_FIELD[kind]]: value }).eq('id', menu.id))
  }

  async function fillMenu() {
    if (!menu || !dishes) return
    const { add, usedWishes } = fill(menu, items, dishes, wishes)
    await run(async () => {
      if (add.length) {
        const r = await supabase.from('menu_items').insert(add.map((a) => ({ ...a, menu_id: menu.id })))
        if (r.error) return r
      }
      return usedWishes.length ? supabase.from('wishes').delete().in('id', usedWishes) : { error: null }
    })
  }

  async function replace(item: MenuItem) {
    if (!dishes) return
    const dish = replacement(item, items, dishes)
    if (!dish) return setError('Aucun autre plat ne respecte les règles pour ce repas.')
    await run(() =>
      supabase
        .from('menu_items')
        .update({ dish_id: dish.id, label: dish.name, meals: mealsFor(dish, item.kind), source: 'generated', eaten: 0 })
        .eq('id', item.id),
    )
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
          moment: item.kind === 'soir' ? 'soir' : 'midi',
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

  const totalMissing = KINDS.reduce((n, k) => n + Math.max(0, need(menu, k) - covered(items, k)), 0)

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
          <p className="muted small">Un plat en promo, une envie ? Il passera en premier au prochain « Remplir ».</p>
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
          {totalMissing > 0 ? `Remplir (${totalMissing} repas à prévoir)` : wishes.length ? 'Ajouter les envies' : 'Tout est prévu'}
        </button>
        <button className="btn ghost" disabled={!dishes} onClick={() => setPicker('menu')}>
          Ajouter un plat
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {KINDS.map((kind) => {
        const list = items.filter((i) => i.kind === kind)
        const have = covered(items, kind)
        const want = need(menu, kind)
        return (
          <section key={kind} className="group" aria-labelledby={`k-${kind}`}>
            <div className="row-between">
              <h2 id={`k-${kind}`}>{KIND_LABEL[kind]}</h2>
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
            </div>
            {have > want && (
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
                      <span className={'dish-name' + (it.eaten >= it.meals ? ' done' : '')}>{it.label}</span>
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

      {picker && dishes && (
        <DishPicker
          title={picker === 'menu' ? 'Ajouter un plat au menu' : 'Ajouter une envie'}
          dishes={dishes}
          withKind={picker === 'menu'}
          confirmLabel="Ajouter au menu"
          onClose={() => setPicker(null)}
          onPick={(dish, kind) => {
            setPicker(null)
            run(() =>
              picker === 'menu'
                ? supabase.from('menu_items').insert({
                    menu_id: menu.id,
                    dish_id: dish.id,
                    label: dish.name,
                    kind,
                    meals: mealsFor(dish, kind),
                    source: 'manual',
                  })
                : supabase.from('wishes').insert({ dish_id: dish.id }),
            )
          }}
        />
      )}
    </main>
  )
}
