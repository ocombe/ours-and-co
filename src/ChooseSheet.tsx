import { useEffect, useMemo, useState } from 'react'
import { Sheet } from './Sheet'
import { COUNTED_KINDS, covered, need, proposals } from './generator'
import { dishesUsingReserve } from './shopping'
import { EFFORT_LABEL, KIND_LABEL, type DishWithStats, type Kind, type Menu, type MenuItem, type Wish } from './types'

const CHOICE_KINDS: Kind[] = [...COUNTED_KINDS, 'kids']

interface Props {
  menu: Menu
  items: MenuItem[]
  dishes: DishWithStats[]
  wishes: Wish[]
  onPick: (dish: DishWithStats, kind: Kind, wish?: Wish) => Promise<void>
  onClose: () => void
}

/** The first kind of meal that still needs dishes. */
function firstMissing(menu: Menu, items: MenuItem[]): Kind | null {
  return COUNTED_KINDS.find((k) => covered(items, k) < need(menu, k)) ?? null
}

/** Short facts to help choose: category, effort, meals covered, when it was last eaten. */
function details(dish: DishWithStats) {
  const out: string[] = [dish.category]
  if (dish.effort === 'quick' || dish.effort === 'long') out.push(EFFORT_LABEL[dish.effort].toLowerCase())
  if (dish.meals_covered > 1) out.push(`${dish.meals_covered} repas`)
  if (dish.weeksAgo != null && dish.weeksAgo < 8)
    out.push(dish.weeksAgo < 1 ? 'mangé cette semaine' : `mangé il y a ${Math.round(dish.weeksAgo)} sem.`)
  return out
}

/** "Choisir un par un": a few proposals for one kind of meal, pick one or draw others. */
export function ChooseSheet({ menu, items, dishes, wishes, onPick, onClose }: Props) {
  const [kind, setKind] = useState<Kind>(() => firstMissing(menu, items) ?? 'soir')
  const [seen, setSeen] = useState<Set<number>>(new Set())
  const [draw, setDraw] = useState(0)
  const [boost, setBoost] = useState<Set<number>>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    dishesUsingReserve().then(setBoost, () => setBoost(new Set()))
  }, [])

  // Only redraw when the menu's dishes change, not on every reload of the same data.
  const menuKey = items.map((i) => `${i.dish_id}:${i.kind}`).join()
  const wishKey = wishes.map((w) => w.id).join()

  const list = useMemo(() => {
    if (!boost) return []
    const opts = { boost, exclude: seen }
    const found = proposals(kind, items, dishes, wishes, opts)
    // Every dish has been shown: start again from the whole catalogue.
    return found.length ? found : proposals(kind, items, dishes, wishes, { boost })
  }, [kind, menuKey, wishKey, dishes, boost, seen, draw])

  // After a pick: once this kind is covered, move on to the next one that is not.
  useEffect(() => {
    if (kind !== 'kids' && covered(items, kind) >= need(menu, kind)) {
      const next = firstMissing(menu, items)
      if (next) choose(next)
    }
  }, [menuKey])

  function choose(k: Kind) {
    setKind(k)
    setSeen(new Set())
  }

  function redraw() {
    setSeen((s) => new Set([...s, ...list.filter((p) => !p.wish).map((p) => p.dish.id)]))
    setDraw((n) => n + 1)
  }

  async function pick(dish: DishWithStats, wish?: Wish) {
    setBusy(true)
    await onPick(dish, kind, wish)
    setBusy(false)
  }

  const have = covered(items, kind)
  const want = need(menu, kind)

  return (
    <Sheet title="Choisir les repas" onClose={onClose}>
      <div className="segmented" role="tablist" aria-label="Repas">
        {CHOICE_KINDS.map((k) => {
          const missing = Math.max(0, need(menu, k) - covered(items, k))
          return (
            <label key={k} className={kind === k ? 'on' : ''}>
              <input type="radio" checked={kind === k} onChange={() => choose(k)} />
              {KIND_LABEL[k]}
              {missing > 0 && <span className="count">{missing}</span>}
            </label>
          )
        })}
      </div>

      <p className="muted small">
        {kind === 'kids'
          ? 'Les plats des filles ne comptent pas dans les repas de la semaine.'
          : have >= want
            ? `Tout est prévu (${have}/${want}). Tu peux quand même en ajouter.`
            : `${have}/${want} prévus : choisis un plat.`}
      </p>

      {!boost ? (
        <p className="muted">Chargement…</p>
      ) : list.length === 0 ? (
        <p className="muted">
          {kind === 'kids'
            ? 'Aucun plat marqué « uniquement pour les filles ». Coche-le dans la fiche du plat.'
            : 'Aucun plat ne respecte les règles pour ce repas.'}
        </p>
      ) : (
        <ul className="dish-list">
          {list.map(({ dish, wish }) => (
            <li key={dish.id}>
              <button className="dish-row choice" disabled={busy} onClick={() => pick(dish, wish)}>
                <span className="dish-name">{dish.name}</span>
                <span className="dish-meta">
                  {wish && <span className="tag">envie</span>}
                  {boost.has(dish.id) && <span className="tag">réserve</span>}
                  <span className="muted">{details(dish).join(' · ')}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="sheet-actions">
        <button type="button" className="btn ghost" disabled={busy || !boost} onClick={redraw}>
          Autres propositions
        </button>
      </div>
    </Sheet>
  )
}
