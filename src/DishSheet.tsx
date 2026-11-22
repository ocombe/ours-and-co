import { useMemo, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import { Sheet } from './Sheet'
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
    kids_only: false,
    season: 'all',
    effort: null,
    favorite: false,
    to_review: false,
    notes: null,
    link: null,
  }
}

/** The columns the sheet edits, cleaned up as they will be saved. */
function editable(d: Draft): Draft {
  // `dish` may carry computed stats (times, weeksAgo) and read-only fields (id, aliases)
  // that must not be sent back.
  return {
    name: d.name.trim(),
    category: d.category,
    usual_moment: d.usual_moment,
    meals_covered: d.meals_covered,
    kids_ok: d.kids_ok,
    kids_only: d.kids_only,
    season: d.season,
    effort: d.effort,
    favorite: d.favorite,
    to_review: d.to_review,
    notes: d.notes?.trim() || null,
    link: d.link?.trim() || null,
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
  const initial = useMemo(() => editable(dish ? { ...dish } : emptyDraft(initialName)), [dish, initialName])
  const [draft, setDraft] = useState<Draft>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const dirty = JSON.stringify(editable(draft)) !== JSON.stringify(initial)

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  /** Saves the dish; true when it worked. */
  async function persist(): Promise<boolean> {
    const row = editable(draft)
    if (!row.name) {
      setError('Le plat doit avoir un nom.')
      return false
    }
    setSaving(true)
    setError('')
    const { error } = dish
      ? await supabase.from('dishes').update(row).eq('id', dish.id)
      : await supabase.from('dishes').insert(row)
    setSaving(false)
    if (error) {
      setError(
        error.code === '23505' ? `Un plat « ${row.name} » existe déjà.` : `Enregistrement impossible : ${error.message}`,
      )
      return false
    }
    return true
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (await persist()) onSaved()
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
    <Sheet
      title={dish ? 'Modifier le plat' : 'Nouveau plat'}
      onClose={onClose}
      dirty={dirty}
      onSave={async () => {
        if (!(await persist())) return false
        onSaved()
        return true
      }}
    >
      <form onSubmit={save} className="stack">
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

        <label className="check">
          <input
            type="checkbox"
            checked={draft.kids_only}
            onChange={(e) => {
              set('kids_only', e.target.checked)
              if (e.target.checked) set('kids_ok', true)
            }}
          />
          Uniquement pour les filles (ne compte pas dans les repas de la semaine)
        </label>

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
    </Sheet>
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
