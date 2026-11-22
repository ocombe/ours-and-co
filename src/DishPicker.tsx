import { useMemo, useState } from 'react'
import { Sheet } from './Sheet'
import { fuzzyFilter } from './fuzzy'
import { defaultKind } from './generator'
import { KIND_LABEL, type DishWithStats, type Kind } from './types'

interface Props {
  title: string
  dishes: DishWithStats[]
  /** Ask which meal it is for (menu), or not (wishes). */
  withKind: boolean
  confirmLabel: string
  onPick: (dish: DishWithStats, kind: Kind) => void
  onClose: () => void
}

/** Search a dish and pick it, optionally choosing the kind of meal. */
export function DishPicker({ title, dishes, withKind, confirmLabel, onPick, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<DishWithStats | null>(null)
  const [kind, setKind] = useState<Kind>('soir')

  const results = useMemo(() => {
    // Without a search: the most eaten first. With one: the best matches first.
    const byTimes = [...dishes].sort((a, b) => b.times - a.times)
    return fuzzyFilter(byTimes, query, (d) => [[d.name, 1], ...d.aliases.map((a): [string, number] => [a, 0.9])]).slice(0, 40)
  }, [dishes, query])

  function choose(d: DishWithStats) {
    if (!withKind) {
      onPick(d, defaultKind(d))
      return
    }
    setSelected(d)
    setKind(defaultKind(d))
  }

  return (
    <Sheet title={title} onClose={onClose}>
      {selected ? (
        <>
          <p className="picked">{selected.name}</p>
          <fieldset className="field">
            <legend>Pour quels repas</legend>
            <div className="segmented">
              {(['midi', 'weekend', 'soir', 'kids'] as Kind[]).map((k) => (
                <label key={k} className={kind === k ? 'on' : ''}>
                  <input type="radio" checked={kind === k} onChange={() => setKind(k)} />
                  {KIND_LABEL[k]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="sheet-actions">
            <button className="btn honey" onClick={() => onPick(selected, kind)}>
              {confirmLabel}
            </button>
            <button className="btn ghost" onClick={() => setSelected(null)}>
              Choisir un autre plat
            </button>
          </div>
        </>
      ) : (
        <>
          <input
            type="search"
            autoFocus
            placeholder="Chercher un plat…"
            aria-label="Chercher un plat"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="dish-list picker-list">
            {results.map((d) => (
              <li key={d.id}>
                <button className="dish-row" onClick={() => choose(d)}>
                  <span className="dish-name">{d.name}</span>
                </button>
              </li>
            ))}
          </ul>
          {results.length === 0 && (
            <p className="muted">Aucun plat ne correspond. Ajoute-le d’abord dans l’onglet Plats.</p>
          )}
        </>
      )}
    </Sheet>
  )
}
