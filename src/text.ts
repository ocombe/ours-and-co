/** Lowercase, no accents: "Épinards" -> "epinards". */
export function fold(s: string) {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const weekday = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' })
const dayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
const full = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short' })

/** Compact moment: "14:32", "hier 14:32", "sam. 14:32" (this week), else "15 nov.". */
export function shortMoment(iso: string, now = new Date()) {
  const d = new Date(iso)
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(now) - day(d)) / 86400000)
  if (days <= 0) return time.format(d)
  if (days === 1) return `hier ${time.format(d)}`
  if (days < 7) return `${weekday.format(d)} ${time.format(d)}`
  return dayMonth.format(d)
}

/** "samedi 22 novembre 2026 à 14:32" */
export function fullMoment(iso: string) {
  return full.format(new Date(iso))
}

const dateFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

/** "2026-11-21" -> "samedi 21 novembre" */
export function longDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return dateFmt.format(new Date(y, m - 1, d))
}
