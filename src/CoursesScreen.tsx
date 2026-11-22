import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import { remember, useTable } from './useTable'
import { fold, fullMoment, shortMoment } from './text'
import { slug } from './route'
import { SuggestInput } from './SuggestInput'
import { AISLES, aisleOf, guessAisle } from './aisles'
import { LOCATIONS, type Ingredient, type ListItem, type Location, type Member, type ShoppingList } from './types'

type SortBy = 'date' | 'name'
type Sort = { by: SortBy; dir: 'asc' | 'desc' }

function readSort(): Sort {
  const [by, dir] = (remember('sort') ?? '').split('-')
  return by === 'name' || by === 'date' ? { by, dir: dir === 'desc' ? 'desc' : 'asc' } : { by: 'date', dir: 'desc' }
}

const byName = new Intl.Collator('fr', { sensitivity: 'base', numeric: true })

function compare(sort: Sort) {
  return (a: ListItem, b: ListItem) => {
    const c = sort.by === 'name' ? byName.compare(a.label, b.label) : Date.parse(a.updated_at) - Date.parse(b.updated_at) || a.id - b.id
    return sort.dir === 'asc' ? c : -c
  }
}

interface Props {
  /** List named in the URL ("#/courses/marche"). */
  listSlug?: string
  /** Show another list: a history step, or `replace` to only fix the URL. */
  onList: (slug: string, replace?: boolean) => void
}

export function CoursesScreen({ listSlug, onList }: Props) {
  const lists = useTable<ShoppingList>('lists', 'position')
  const items = useTable<ListItem>('list_items', 'id')
  const ingredients = useTable<Ingredient>('ingredients', 'name')
  const [label, setLabel] = useState('')
  const [quantity, setQuantity] = useState('')
  const [open, setOpen] = useState<number | null>(null) // item whose options are shown
  const [error, setError] = useState('')
  const { members, me, since } = useVisit()
  const [sort, setSortState] = useState<Sort>(readSort)

  /** Click on a column: same column flips the order, the other one starts A→Z / newest first. */
  function sortBy(by: SortBy) {
    const next: Sort = sort.by === by ? { by, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { by, dir: by === 'name' ? 'asc' : 'desc' }
    setSortState(next)
    remember('sort', `${next.by}-${next.dir}`)
  }

  // The list in the URL, else the last one used, else the first.
  const current =
    lists.rows?.find((l) => slug(l.name) === listSlug) ??
    lists.rows?.find((l) => l.id === Number(remember('list'))) ??
    lists.rows?.[0]

  useEffect(() => {
    if (!current) return
    remember('list', String(current.id))
    if (slug(current.name) !== listSlug) onList(slug(current.name), true)
  }, [current, listSlug, onList])

  async function act(p: PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await p
    setError(error ? error.message : '')
  }

  if (!lists.rows || !items.rows) {
    return (
      <main className="screen">
        <h1>Courses</h1>
        <p className={lists.error || items.error ? 'error' : 'muted'}>{lists.error || items.error || 'Chargement…'}</p>
      </main>
    )
  }

  const mine = items.rows.filter((i) => i.list_id === current?.id).sort(compare(sort))
  const todo = mine.filter((i) => !i.done)
  const done = mine.filter((i) => i.done)
  const openCount = (id: number) => items.rows!.filter((i) => i.list_id === id && !i.done).length
  /** Added by someone else (the other one, or Claude) since my last visit. */
  const isNew = (i: ListItem) => !!since && !i.done && i.added_by !== me && Date.parse(i.created_at) > since
  const hasNew = (id: number) => items.rows!.some((i) => i.list_id === id && isNew(i))
  const findIngredient = (name: string) => ingredients.rows?.find((i) => fold(i.name) === fold(name))

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!current || !label.trim()) return
    const ing = findIngredient(label.trim())
    await act(
      supabase.from('list_items').insert({
        list_id: current.id,
        label: label.trim(),
        quantity: quantity.trim() || null,
        ingredient_id: ing?.id ?? null,
        aisle: ing?.aisle ?? guessAisle(label),
      }),
    )
    setLabel('')
    setQuantity('')
  }

  /** Change an item's aisle and remember it for this product next time. */
  async function setAisle(item: ListItem, aisle: string) {
    setOpen(null)
    let ingredientId = item.ingredient_id ?? findIngredient(item.label)?.id ?? null
    if (ingredientId) {
      await supabase.from('ingredients').update({ aisle }).eq('id', ingredientId)
    } else {
      const created = await supabase.from('ingredients').insert({ name: item.label, aisle }).select('id').single()
      ingredientId = created.data?.id ?? null
    }
    await act(supabase.from('list_items').update({ aisle, ingredient_id: ingredientId }).eq('id', item.id))
  }

  async function toReserve(item: ListItem, location: Location) {
    setOpen(null)
    const r = await supabase
      .from('reserve_items')
      .insert({ label: item.label, quantity: item.quantity, location, ingredient_id: item.ingredient_id })
    if (r.error) return setError(r.error.message)
    await act(supabase.from('list_items').delete().eq('id', item.id))
  }

  function row(it: ListItem) {
    return (
      <li key={it.id} className={'list-row' + (it.done ? ' is-done' : '')}>
        <div className="list-row-main">
          <label className="check-row">
            <input
              type="checkbox"
              checked={it.done}
              onChange={() => act(supabase.from('list_items').update({ done: !it.done }).eq('id', it.id))}
            />
            <span>
              <span className="item-label">{it.label}</span>
              {it.quantity && <span className="muted"> {it.quantity}</span>}
              {isNew(it) && <span className="tag new">nouveau</span>}
            </span>
          </label>
          <AddedBy member={members.find((m) => m.user_id === it.added_by)} />
          <time className="added-at muted" dateTime={it.updated_at} title={`Modifié le ${fullMoment(it.updated_at)}`}>
            {shortMoment(it.updated_at)}
          </time>
          <button
            className="icon-btn"
            aria-expanded={open === it.id}
            aria-label={`Options pour ${it.label}`}
            onClick={() => setOpen(open === it.id ? null : it.id)}
          >
            ⋯
          </button>
        </div>
        {open === it.id && (
          <div className="item-options">
            <label className="field">
              <span>Rayon</span>
              <select value={aisleOf(it)} onChange={(e) => setAisle(it, e.target.value)}>
                {AISLES.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              <span>Mettre en réserve</span>
              <div className="segmented">
                {LOCATIONS.map((loc) => (
                  <button key={loc} className="btn ghost small" onClick={() => toReserve(it, loc)}>
                    {loc}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </li>
    )
  }

  const byAisle = AISLES.map((a) => ({ aisle: a, items: todo.filter((i) => aisleOf(i) === a) })).filter((g) => g.items.length)

  return (
    <main className="screen">
      <div className="screen-head">
        <h1>Courses</h1>
      </div>

      <div className="search-bar">
        <div className="chips" role="tablist" aria-label="Listes">
          {lists.rows.map((l) => (
            <button
              key={l.id}
              role="tab"
              aria-selected={l.id === current?.id}
              className={'chip' + (l.id === current?.id ? ' on' : '')}
              onClick={() => onList(slug(l.name))}
            >
              {l.name}
              {openCount(l.id) > 0 && (
                <span className={'count' + (hasNew(l.id) ? ' new' : '')} title={hasNew(l.id) ? 'Nouveaux articles' : undefined}>
                  {openCount(l.id)}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <form className="add-row" onSubmit={add}>
        <SuggestInput
          aria-label={`Ajouter à ${current?.name}`}
          placeholder={`Ajouter à ${current?.name}…`}
          value={label}
          onChange={setLabel}
          options={ingredients.rows?.map((i) => i.name) ?? []}
        />
        <input className="qty" aria-label="Quantité" placeholder="Qté" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <button className="btn honey">Ajouter</button>
      </form>

      {error && <p className="error">{error}</p>}

      {todo.length === 0 && done.length === 0 ? (
        <p className="muted">La liste est vide.</p>
      ) : (
        <div className="sort-head" role="group" aria-label="Trier">
          <SortButton label="Article" by="name" sort={sort} onClick={sortBy} />
          <SortButton label="Modifié" by="date" sort={sort} onClick={sortBy} />
        </div>
      )}

      {byAisle.map((g) => (
        <section key={g.aisle} className="group aisle">
          <h2>{g.aisle}</h2>
          <ul className="dish-list">{g.items.map(row)}</ul>
        </section>
      ))}

      {done.length > 0 && (
        <section className="group">
          <div className="row-between">
            <h2>Dans le panier</h2>
            <button
              className="btn ghost small"
              onClick={() => act(supabase.from('list_items').delete().in('id', done.map((d) => d.id)))}
            >
              Retirer les {done.length} articles cochés
            </button>
          </div>
          <ul className="dish-list">{done.map(row)}</ul>
        </section>
      )}
    </main>
  )
}

/**
 * Household members (for their photos), who I am, and my previous visit to the lists:
 * opening the screen, or coming back to the app on it, counts as a visit.
 */
function useVisit() {
  const [members, setMembers] = useState<Member[]>([])
  const [me, setMe] = useState<string | null>(null)
  const [since, setSince] = useState<number | null>(null)

  useEffect(() => {
    supabase
      .from('members')
      .select('user_id, display_name, avatar_url')
      .then(({ data }) => setMembers((data as Member[]) ?? []))
    supabase.auth.getSession().then(({ data }) => setMe(data.session?.user.id ?? null))

    async function visit() {
      const { data } = await supabase.rpc('mark_lists_seen')
      setSince(data ? Date.parse(data as string) : null)
    }
    visit()
    const onVisible = () => document.visibilityState === 'visible' && visit()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  return { members, me, since }
}

/** Photo of who added an item (or their initial if there is no photo). */
function AddedBy({ member }: { member?: Member }) {
  if (!member) return null
  const label = `Ajouté par ${member.display_name}`
  return member.avatar_url ? (
    <img className="avatar" src={member.avatar_url} alt={label} title={label} width={24} height={24} referrerPolicy="no-referrer" />
  ) : (
    <span className="avatar initial" title={label} aria-label={label}>
      {member.display_name.slice(0, 1)}
    </span>
  )
}

function SortButton({ label, by, sort, onClick }: { label: string; by: SortBy; sort: Sort; onClick: (by: SortBy) => void }) {
  const active = sort.by === by
  const order =
    by === 'name' ? (sort.dir === 'asc' ? 'de A à Z' : 'de Z à A') : sort.dir === 'asc' ? 'du plus ancien' : 'du plus récent'
  return (
    <button
      type="button"
      className={'sort-btn' + (active ? ' on' : '')}
      aria-pressed={active}
      title={active ? `Trié ${order}, toucher pour inverser` : `Trier par ${label.toLowerCase()}`}
      onClick={() => onClick(by)}
    >
      {label}
      <span aria-hidden="true">{active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ' ↕'}</span>
      {active && <span className="visually-hidden">, trié {order}</span>}
    </button>
  )
}
