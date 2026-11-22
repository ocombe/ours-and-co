import { fold } from './text'

/**
 * Fuzzy search, forgiving typos: "tartifelte" finds "Tartiflette", "poulet roti"
 * finds "Poulet rôti", "lasagne" finds "Lasagnes", "cordon" finds "Cordons bleus".
 * Every word typed must match a word of the text, by one of (best first):
 * - substring ("courge" in "butternut courge"), best at the start of a word;
 * - few typos (insert, delete, swap or replace a letter) against a word or the start of one;
 * - same French sound ("kiche" → "quiche", "potofeu" → "pot-au-feu");
 * - letters in order, close together ("pltrt" → "poulet roti"), for 3 letters or more.
 */

function words(s: string) {
  return fold(s).split(/[^a-z0-9]+/).filter(Boolean)
}

/** Edit distance with swaps of two neighbouring letters (optimal string alignment). */
function distance(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      rowMin = Math.min(rowMin, d[i][j])
    }
    if (rowMin > max) return max + 1
  }
  return d[a.length][b.length]
}

/** Rough French pronunciation, to forgive spelling: "quiche" and "kiche" both give "kich". */
function sound(w: string) {
  return w
    .replace(/qu|ck|c(?=[aouklrt])|q/g, 'k')
    .replace(/ph/g, 'f')
    .replace(/eau|au/g, 'o')
    .replace(/ai|ei/g, 'e')
    .replace(/y/g, 'i')
    .replace(/h/g, '')
    .replace(/([a-z])\1+/g, '$1')
    .replace(/(?<=..)[sxtd]$/, '')
}

/** Typos allowed for a word of this length. */
function allowed(n: number) {
  return n <= 3 ? 0 : n <= 6 ? 1 : 2
}

/** Letters of `q` in order in `t`, within a short span. */
function inOrder(q: string, t: string) {
  let start = -1
  let i = 0
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) {
      if (i === 0) start = j
      i++
      if (i === q.length) return j - start + 1 <= q.length * 2.5
    }
  }
  return false
}

function wordScore(q: string, text: string, textWords: string[]) {
  // The word itself (singular or plural), then a word starting with it ("courge" before "courgettes").
  if (textWords.some((w) => w === q || w === q + 's' || w === q + 'x')) return 1
  if (textWords.some((w) => w.startsWith(q))) return 0.95
  // One or two letters: only at the start of a word, else nearly everything matches.
  if (q.length <= 2) return 0
  if (text.includes(q)) return 0.9
  const max = allowed(q.length)
  if (max > 0) {
    let best = max + 1
    for (const w of textWords) {
      // Against the whole word, or its start (still typing: "tartifl" → "tartiflette").
      best = Math.min(best, distance(q, w, max), distance(q, w.slice(0, q.length), max))
    }
    if (best <= max) return 0.75 - 0.15 * best
  }
  const qs = sound(q)
  if (qs.length >= 3) {
    const joined = sound(text.replace(/ /g, ''))
    if (textWords.some((w) => sound(w).startsWith(qs)) || joined.includes(qs)) return 0.5
  }
  if (inOrder(q, text.replace(/ /g, ''))) return 0.3
  return 0
}

/** 0 when the text does not match, else up to 1 (better match). */
export function fuzzyScore(query: string, text: string): number {
  const all = words(query)
  // Single letters ("pot o feu", "steak a l'ail") are noise unless that is all there is.
  const qs = all.length > 1 ? all.filter((w) => w.length > 1) : all
  if (qs.length === 0) return 1
  const tw = words(text)
  const t = tw.join(' ')
  let total = 0
  for (const q of qs) {
    const s = wordScore(q, t, tw)
    if (s === 0) return 0
    total += s
  }
  // Small bonus when the text is not much longer than the query (closer to what was typed).
  return (total / qs.length) * (0.9 + 0.1 * Math.min(1, qs.join(' ').length / t.length))
}

/**
 * Items matching the query, best first (ties keep their order). Each item can have several
 * texts (name, old names, ingredients…) with a weight: its score is the best of them.
 */
export function fuzzyFilter<T>(items: T[], query: string, texts: (item: T) => [string, number][]): T[] {
  if (!query.trim()) return items
  return items
    .map((item, i) => ({ item, i, score: Math.max(0, ...texts(item).map(([t, w]) => fuzzyScore(query, t) * w)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.item)
}
