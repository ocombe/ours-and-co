import { useState, type FormEvent } from 'react'
import { useTable } from './useTable'
import { upsert } from './live'
import { deleteRows, insertRow } from './offline'
import { LOCATIONS, type Location, type ReserveItem } from './types'

const LOCATION_TITLE: Record<Location, string> = {
  congélateur: 'Congélateur',
  frigo: 'Frigo',
  placard: 'Placard',
}

export function ReserveScreen() {
  const reserve = useTable<ReserveItem>('reserve_items', 'id')
  const [label, setLabel] = useState('')
  const [quantity, setQuantity] = useState('')
  const [location, setLocation] = useState<Location>('congélateur')
  const [error, setError] = useState('')

  async function act(p: PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await p
    setError(error ? error.message : '')
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!label.trim()) return
    // Shown at once (offline too: it is sent when the network comes back).
    const r = await insertRow<ReserveItem>('reserve_items', { label: label.trim(), quantity: quantity.trim() || null, location }, { ingredient_id: null })
    setError(r.error ? r.error.message : '')
    if (r.data) reserve.mutate((rows) => upsert(rows, r.data as ReserveItem))
    setLabel('')
    setQuantity('')
  }

  return (
    <main className="screen">
      <div className="screen-head">
        <h1>Réserve</h1>
      </div>
      <p className="muted small">
        Ce qu’on a d’avance. Ces produits ne sont pas remis dans les courses, et les plats qui les utilisent passent en
        priorité.
      </p>

      <form className="stack add-reserve" onSubmit={add}>
        <div className="add-row">
          <input
            aria-label="Produit"
            placeholder="2 magrets, 1 kg de lentilles…"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <input className="qty" aria-label="Quantité" placeholder="Qté" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <div className="row-between">
          <div className="segmented" role="radiogroup" aria-label="Où">
            {LOCATIONS.map((l) => (
              <label key={l} className={location === l ? 'on' : ''}>
                <input type="radio" checked={location === l} onChange={() => setLocation(l)} />
                {LOCATION_TITLE[l]}
              </label>
            ))}
          </div>
          <button className="btn honey">Ajouter</button>
        </div>
      </form>

      {(error || reserve.error) && <p className="error">{error || reserve.error}</p>}
      {!reserve.rows && !reserve.error && <p className="muted">Chargement…</p>}
      {reserve.rows?.length === 0 && <p className="muted">La réserve est vide.</p>}

      {reserve.rows &&
        LOCATIONS.map((loc) => {
          const here = reserve.rows!.filter((r) => r.location === loc)
          if (here.length === 0) return null
          return (
            <section key={loc} className="group">
              <h2>
                {LOCATION_TITLE[loc]}
                <span className="muted"> {here.length}</span>
              </h2>
              <ul className="dish-list">
                {here.map((r) => (
                  <li key={r.id} className="list-row">
                    <span>
                      <span className="item-label">{r.label}</span>
                      {r.quantity && <span className="muted"> {r.quantity}</span>}
                    </span>
                    <button className="btn ghost small" onClick={() => {
                        reserve.mutate((rows) => rows.filter((x) => x.id !== r.id))
                        act(deleteRows('reserve_items', [r.id]))
                      }}>
                      Utilisé
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
    </main>
  )
}
