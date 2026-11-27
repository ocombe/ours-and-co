import { useState } from 'react'
import { Sheet } from './Sheet'
import { mealsFor } from './generator'
import { KIND_LABEL, type DishWithStats, type Kind, type MenuItem } from './types'

export interface MenuItemChanges {
  kind: Kind
  meals: number
}

const KINDS: Kind[] = ['weekend', 'midi', 'soir', 'kids']

/**
 * Meals a dish covers when moved to another kind of meal: the dish's usual count for that
 * kind, unless the count was changed by hand (a leftover, a bigger batch); never fewer
 * than the parts already eaten.
 */
export function mealsAfterMove(item: MenuItem, dish: DishWithStats | undefined, kind: Kind) {
  const usual = dish && item.meals === mealsFor(dish, item.kind) && item.source !== 'leftover'
  return Math.max(item.eaten, 1, usual ? mealsFor(dish, kind) : item.meals)
}

interface Props {
  item: MenuItem
  dish?: DishWithStats
  onClose: () => void
  onSave: (changes: MenuItemChanges) => Promise<boolean>
  onOpenDish: () => void
}

/** One dish of this week's menu: which meals it is for and how many it covers (this week only). */
export function MenuItemSheet({ item, dish, onClose, onSave, onOpenDish }: Props) {
  const [draft, setDraft] = useState<MenuItemChanges>({ kind: item.kind, meals: item.meals })
  const dirty = draft.kind !== item.kind || draft.meals !== item.meals
  const min = Math.max(1, item.eaten)

  function setKind(kind: Kind) {
    // Follow the dish's usual count for the new kind if the count was not changed here.
    const untouched = draft.meals === item.meals
    setDraft({ kind, meals: untouched ? mealsAfterMove(item, dish, kind) : draft.meals })
  }

  return (
    <Sheet title={dish?.name ?? item.label} onClose={onClose} dirty={dirty} onSave={() => onSave(draft)}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault()
          await onSave(draft)
        }}
      >
        <fieldset className="field">
          <legend>Pour quels repas</legend>
          <div className="segmented">
            {KINDS.map((k) => (
              <label key={k} className={draft.kind === k ? 'on' : ''}>
                <input type="radio" checked={draft.kind === k} onChange={() => setKind(k)} />
                {KIND_LABEL[k]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <span id="item-meals">Nombre de repas, cette semaine</span>
          <div className="stepper" role="group" aria-labelledby="item-meals">
            <button
              type="button"
              aria-label="Un repas de moins"
              disabled={draft.meals <= min}
              onClick={() => setDraft({ ...draft, meals: draft.meals - 1 })}
            >
              −
            </button>
            <output aria-live="polite">{draft.meals}</output>
            <button
              type="button"
              aria-label="Un repas de plus"
              disabled={draft.meals >= 10}
              onClick={() => setDraft({ ...draft, meals: draft.meals + 1 })}
            >
              +
            </button>
          </div>
          <p className="muted small">
            {item.source === 'leftover' ? 'Reste de la semaine dernière. ' : ''}
            {dish && `D’habitude, ce plat fait ${dish.meals_covered} repas à 2. `}
            Ça ne change que ce menu, pas la fiche du plat.
            {item.eaten > 0 && ` ${item.eaten} déjà mangé${item.eaten > 1 ? 's' : ''}.`}
          </p>
        </div>

        <div className="sheet-actions">
          <button className="btn honey">Enregistrer</button>
          {dish && (
            <button type="button" className="btn ghost" onClick={onOpenDish}>
              Fiche du plat
            </button>
          )}
        </div>
      </form>
    </Sheet>
  )
}
