import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import { DishIngredients } from './DishIngredients'
import {
  CATEGORIES,
  EFFORT_LABEL,
  MOMENT_LABEL,
  SEASON_LABEL,
  type Dish,
  type Effort,
  type Moment,
  type Season,
} from './types'

type Draft = Omit<Dish, 'id' | 'aliases' | 'familywall_box'>

function emptyDraft(name: string): Draft {
  return {
    name,
    category: 'volaille',
    usual_moment: 'soir',
    meals_covered: 1,
    kids_ok: null,
    season: 'all',
    effort: null,
    favorite: false,
    to_review: false,
    notes: null,
    link: null,
  }
}

interface Props {
  dish: Dish | null
  initialName: string
  onClose: () => void
  onSaved: () => void
}

/** Bottom sheet to create or edit a dish. */
export function DishSheet({ dish, initialName, onClose, onSaved }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState<Draft>(() => (dish ? { ...dish } : emptyDraft(initialName)))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    // Only the editable columns: `dish` may carry computed stats (times, weeksAgo)
    // and read-only fields (id, aliases) that must not be sent back.
    const row: Draft = {
      name: draft.name.trim(),
      category: draft.category,
      usual_moment: draft.usual_moment,
      meals_covered: draft.meals_covered,
      kids_ok: draft.kids_ok,
      season: draft.season,
      effort: draft.effort,
      favorite: draft.favorite,
      to_review: draft.to_review,
      notes: draft.notes?.trim() || null,
      link: draft.link?.trim() || null,
    }
    const { error } = dish
      ? await supabase.from('dishes').update(row).eq('id', dish.id)
      : await supabase.from('dishes').insert(row)
    setSaving(false)
    if (error) {
      setError(
        error.code === '23505' ? `Un plat « ${row.name} » existe déjà.` : `Enregistrement impossible : ${error.message}`,
      )
      return
    }
    onSaved()
  }

  async function remove() {
    if (!dish) return
    setSaving(true)
    const { error } = await supabase.from('dishes').delete().eq('id', dish.id)
    setSaving(false)
    if (error) {
      setError(`Suppression impossible : ${error.message}`)
      return
    }
    onSaved()
  }

  return (
    <dialog ref={dialog} className="sheet" onClose={onClose} aria-labelledby="sheet-title">
      <form onSubmit={save} className="stack">
        <div className="sheet-head">
          <h2 id="sheet-title">{dish ? 'Modifier le plat' : 'Nouveau plat'}</h2>
          <button type="button" className="btn ghost small" onClick={() => dialog.current?.close()}>
            Fermer
          </button>
        </div>

        {dish?.to_review && (
          <div className="notice">
            <p>Ce plat a été classé automatiquement. Vérifie le moment et les infos.</p>
            <button type="button" className="btn ghost small" onClick={() => set('to_review', false)}>
              {draft.to_review ? 'Marquer comme vérifié' : 'Vérifié ✓'}
            </button>
          </div>
        )}

        <label className="field">
          <span>Nom</span>
          <input required value={draft.name} onChange={(e) => set('name', e.target.value)} />
        </label>

        <label className="field">
          <span>Catégorie</span>
          <select value={draft.category} onChange={(e) => set('category', e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <Segmented
          label="Moment habituel"
          value={draft.usual_moment}
          options={Object.entries(MOMENT_LABEL) as [Moment, string][]}
          onChange={(v) => set('usual_moment', v)}
        />

        <div className="field">
          <span id="meals-label">Nombre de repas couverts (à 2)</span>
          <div className="stepper" role="group" aria-labelledby="meals-label">
            <button
              type="button"
              aria-label="Un repas de moins"
              disabled={draft.meals_covered <= 1}
              onClick={() => set('meals_covered', draft.meals_covered - 1)}
            >
              −
            </button>
            <output aria-live="polite">{draft.meals_covered}</output>
            <button
              type="button"
              aria-label="Un repas de plus"
              disabled={draft.meals_covered >= 10}
              onClick={() => set('meals_covered', draft.meals_covered + 1)}
            >
              +
            </button>
          </div>
        </div>

        <Segmented
          label="Les filles en mangent"
          value={draft.kids_ok === null ? 'unknown' : draft.kids_ok ? 'yes' : 'no'}
          options={[
            ['yes', 'Oui'],
            ['no', 'Non'],
            ['unknown', 'Je ne sais pas'],
          ]}
          onChange={(v) => set('kids_ok', v === 'unknown' ? null : v === 'yes')}
        />

        <Segmented
          label="Saison"
          value={draft.season}
          options={Object.entries(SEASON_LABEL) as [Season, string][]}
          onChange={(v) => set('season', v)}
        />

        <Segmented
          label="Difficulté"
          value={draft.effort ?? 'none'}
          options={[...(Object.entries(EFFORT_LABEL) as [Effort, string][]), ['none', 'Non précisé']]}
          onChange={(v) => set('effort', v === 'none' ? null : (v as Effort))}
        />

        <label className="check">
          <input type="checkbox" checked={draft.favorite} onChange={(e) => set('favorite', e.target.checked)} />
          Favori (tiré plus souvent)
        </label>

        {dish ? (
          <DishIngredients dishId={dish.id} />
        ) : (
          <p className="muted small">Les ingrédients s’ajoutent une fois le plat enregistré.</p>
        )}

        <label className="field">
          <span>Notes ou recette</span>
          <textarea rows={4} value={draft.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </label>

        <label className="field">
          <span>Lien</span>
          <input type="url" value={draft.link ?? ''} onChange={(e) => set('link', e.target.value)} />
        </label>

        {dish && dish.aliases.length > 0 && (
          <p className="muted small">Noms dans FamilyWall : {dish.aliases.join(', ')}</p>
        )}

        {error && <p className="error">{error}</p>}

        <div className="sheet-actions">
          <button className="btn honey" disabled={saving}>
            {dish ? 'Enregistrer' : 'Ajouter le plat'}
          </button>
          {dish &&
            (confirmDelete ? (
              <button type="button" className="btn danger" disabled={saving} onClick={remove}>
                Confirmer la suppression
              </button>
            ) : (
              <button type="button" className="btn ghost" onClick={() => setConfirmDelete(true)}>
                Supprimer
              </button>
            ))}
        </div>
      </form>
    </dialog>
  )
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: [T, string][]
  onChange: (v: T) => void
}) {
  return (
    <fieldset className="field">
      <legend>{label}</legend>
      <div className="segmented">
        {options.map(([v, text]) => (
          <label key={v} className={value === v ? 'on' : ''}>
            <input type="radio" checked={value === v} onChange={() => onChange(v)} />
            {text}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
