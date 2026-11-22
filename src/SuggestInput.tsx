import { useId, useMemo, useState, type InputHTMLAttributes } from 'react'
import { fuzzyFilter } from './fuzzy'
import { fold } from './text'

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string
  onChange: (value: string) => void
  /** Known values to suggest (products, ingredients…), matched fuzzily. */
  options: string[]
  max?: number
}

/**
 * Text input with fuzzy suggestions below it (in place of a <datalist>, which only
 * matches exact text). Arrows to move, Enter or a tap to choose, Escape to hide.
 * Enter with no suggestion highlighted is left to the form (it submits).
 */
export function SuggestInput({ value, onChange, options, max = 6, className, onKeyDown, ...rest }: Props) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)

  const matches = useMemo(() => {
    if (!value.trim()) return []
    const found = fuzzyFilter(options, value, (o) => [[o, 1]]).slice(0, max)
    // Already typed exactly: nothing to suggest.
    return found.length === 1 && fold(found[0]) === fold(value.trim()) ? [] : found
  }, [value, options, max])

  const shown = open && matches.length > 0

  function choose(v: string) {
    onChange(v)
    setOpen(false)
    setActive(-1)
  }

  return (
    <div className={'suggest ' + (className ?? '')}>
      <input
        {...rest}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={id}
        aria-activedescendant={shown && active >= 0 ? `${id}-${active}` : undefined}
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (shown && e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => (a + 1) % matches.length)
          } else if (shown && e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => (a <= 0 ? matches.length - 1 : a - 1))
          } else if (shown && e.key === 'Enter' && active >= 0) {
            e.preventDefault()
            choose(matches[active])
          } else if (shown && e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            setOpen(false)
          } else {
            onKeyDown?.(e)
          }
        }}
      />
      {shown && (
        <ul className="suggest-list" role="listbox" id={id}>
          {matches.map((m, i) => (
            <li
              key={m}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'on' : ''}
              // mousedown, not click: keep the focus in the input.
              onMouseDown={(e) => {
                e.preventDefault()
                choose(m)
              }}
            >
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
