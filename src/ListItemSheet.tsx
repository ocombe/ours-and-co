import { useState } from 'react'
import { Sheet } from './Sheet'
import { AISLES, aisleOf } from './aisles'
import { fullMoment } from './text'
import { LOCATIONS, type ListItem, type Location, type ShoppingList } from './types'

export interface ItemChanges {
  label: string
  quantity: string | null
  note: string | null
  aisle: string
  list_id: number
}

interface Props {
  item: ListItem
  lists: ShoppingList[]
  addedBy?: string
  onClose: () => void
  /** Saves; resolves to true when it worked. */
  onSave: (changes: ItemChanges) => Promise<boolean>
  onReserve: (location: Location) => void
  onDelete: () => void
}

/** Details of a shopping item: name, quantity, aisle, list; to the reserve or deleted. */
export function ListItemSheet({ item, lists, addedBy, onClose, onSave, onReserve, onDelete }: Props) {
  const initial: ItemChanges = { label: item.label, quantity: item.quantity, note: item.note, aisle: aisleOf(item), list_id: item.list_id }
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState('')
  const clean = (d: ItemChanges): ItemChanges => ({
    ...d,
    label: d.label.trim(),
    quantity: d.quantity?.trim() || null,
    note: d.note?.trim() || null,
  })
  const dirty = JSON.stringify(clean(draft)) !== JSON.stringify(clean(initial))

  async function save() {
    if (!draft.label.trim()) {
      setError('Le produit doit avoir un nom.')
      return false
    }
    return onSave(clean(draft))
  }

  return (
    <Sheet title="Produit" onClose={onClose} dirty={dirty} onSave={save}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault()
          await save()
        }}
      >
        <div className="add-row">
          <label className="field grow">
            <span>Nom</span>
            <input required value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          </label>
          <label className="field qty">
            <span>Quantité</span>
            <input value={draft.quantity ?? ''} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} />
          </label>
        </div>

        <label className="field">
          <span>Note</span>
          <textarea
            rows={2}
            placeholder="Bio, la marque verte, pour la quiche…"
            value={draft.note ?? ''}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          />
        </label>

        <label className="field">
          <span>Rayon (retenu pour ce produit)</span>
          <select value={draft.aisle} onChange={(e) => setDraft({ ...draft, aisle: e.target.value })}>
            {AISLES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Liste</span>
          <select value={draft.list_id} onChange={(e) => setDraft({ ...draft, list_id: Number(e.target.value) })}>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>

        <p className="muted small">
          Modifié le {fullMoment(item.updated_at)}
          {addedBy && ` · ajouté par ${addedBy}`}
        </p>

        {error && <p className="error">{error}</p>}

        <div className="sheet-actions">
          <button className="btn honey">Enregistrer</button>
          <button type="button" className="btn ghost" onClick={onDelete}>
            Supprimer
          </button>
        </div>

        <div className="field">
          <span>On en a déjà : mettre en réserve</span>
          <div className="segmented">
            {LOCATIONS.map((loc) => (
              <button key={loc} type="button" className="btn ghost small" onClick={() => onReserve(loc)}>
                {loc}
              </button>
            ))}
          </div>
        </div>
      </form>
    </Sheet>
  )
}
