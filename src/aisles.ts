import { fold } from './text'

/** Aisles, in the order we walk through a shop or a market. */
export const AISLES = [
  'Fruits & légumes',
  'Boulangerie',
  'Boucherie & volaille',
  'Poissonnerie',
  'Crèmerie & fromages',
  'Épicerie',
  'Surgelés',
  'Boissons',
  'Hygiène & maison',
  'Autre',
] as const
export type Aisle = (typeof AISLES)[number]

/**
 * Keywords per aisle (lowercase, no accents). A keyword can be several words
 * ("pomme de terre"); plurals in s / x are matched too. A leading "=" means the exact
 * word only, no plural ("=pate" is pâté, not pâtes).
 */
const KEYWORDS: Record<Exclude<Aisle, 'Autre'>, string[]> = {
  'Fruits & légumes': [
    'salade', 'laitue', 'mache', 'roquette', 'carotte', 'tomate', 'courge', 'butternut', 'potimarron', 'potiron',
    'citrouille', 'courgette', 'aubergine', 'poivron', 'oignon', 'ail', 'echalote', 'poireau', 'endive', 'epinard',
    'chou', 'chou fleur', 'brocoli', 'haricot', 'haricot vert', 'betterave', 'champignon', 'pomme de terre', 'patate',
    'avocat', 'banane', 'pomme', 'poire', 'clementine', 'mandarine', 'orange', 'citron', 'pamplemousse', 'kiwi',
    'fraise', 'framboise', 'myrtille', 'cerise', 'raisin', 'melon', 'pasteque', 'peche', 'nectarine', 'abricot', 'prune',
    'mangue', 'ananas', 'figue', 'cresson', 'blette', 'navet', 'radis', 'concombre', 'celeri', 'fenouil', 'artichaut',
    'asperge', 'petit pois', 'panais', 'topinambour', 'gingembre', 'herbe', 'persil', 'basilic', 'coriandre',
    'ciboulette', 'menthe', 'thym', 'romarin', 'aneth', 'legume', 'fruit',
  ],
  Boulangerie: ['pain', 'baguette', 'ficelle', 'brioche', 'viennoiserie', 'croissant', 'chocolatine', 'fougasse'],
  'Boucherie & volaille': [
    'viande', 'poulet', 'dinde', 'pintade', 'boeuf', 'steak', 'veau', 'porc', 'agneau', 'gigot', 'roti', 'saucisse',
    'saucisson', 'chipolata', 'merguez', 'chorizo', 'lardon', 'jambon', 'cordon bleu', 'caillette', 'magret', 'canard',
    'lapin', 'filet mignon', 'escalope', 'cote', 'cotelette', 'entrecote', 'bavette', 'onglet', 'rumsteck', 'faux filet',
    'paupiette', 'cuisse', 'aiguillette', 'blanc de poulet', 'hache', 'quenelle', 'rillette', '=pate', 'terrine',
  ],
  Poissonnerie: [
    'poisson', 'saumon', 'cabillaud', 'lieu', 'dorade', 'daurade', 'sole', 'merlu', 'colin', 'bar', 'truite', 'sardine',
    'maquereau', 'eglefin', 'haddock', 'thon', 'crevette', 'gambas', 'moule', 'saint jacques', 'calamar', 'encornet',
    'crabe', 'huitre', 'surimi', 'fruit de mer',
  ],
  'Crèmerie & fromages': [
    'oeuf', 'lait', 'beurre', 'creme', 'yaourt', 'skyr', 'fromage', 'fromage blanc', 'faisselle', 'petit suisse', 'comte',
    'chevre', 'emmental', 'gruyere', 'parmesan', 'mozzarella', 'burrata', 'ricotta', 'mascarpone', 'feta', 'kiri',
    'raclette', 'reblochon', 'tomme', 'morbier', 'camembert', 'brie', 'coulommiers', 'roquefort', 'cheddar',
    'cancoillotte',
  ],
  Épicerie: [
    'pates', 'riz', 'farine', 'sucre', 'sel', 'poivre', 'huile', 'vinaigre', 'conserve', 'coulis', 'sauce', 'nouille',
    'tagliatelle', 'penne', 'macaroni', 'spaghetti', 'coquillette', 'fusilli', 'lasagne', 'gnocchi', 'ravioli', 'semoule',
    'quinoa', 'boulgour', 'lentille', 'pois chiche', 'chocolat', 'biscuit', 'gateau', 'cereale', 'muesli', 'confiture',
    'miel', 'epice', 'moutarde', 'mayonnaise', 'ketchup', 'mais', 'cafe', 'the', 'tisane', 'infusion', 'compote',
    'levure', 'bouillon', 'cornichon', 'olive', 'chips', 'cacahuete', 'noix', 'noisette', 'amande', 'pistache',
    'raisin sec', 'fruit sec', 'abricot sec', 'tomate sechee', 'pate brisee', 'pate feuilletee', 'pate sablee',
    'pate a pizza', 'lait de coco', 'beurre de cacahuete', 'creme de marron',
  ],
  Surgelés: ['surgele', 'glace', 'sorbet', 'esquimau', 'frite', 'picard'],
  Boissons: ['eau', 'jus', 'vin', 'biere', 'cidre', 'champagne', 'sirop', 'soda', 'limonade', 'coca'],
  'Hygiène & maison': [
    'javel', 'lingette', 'savon', 'shampoing', 'gel douche', 'dentifrice', 'brosse a dent', 'deodorant', 'rasoir', 'coton',
    'couche', 'lessive', 'adoucissant', 'liquide vaisselle', 'lave vaisselle', 'papier', 'essuie tout', 'sopalin',
    'mouchoir', 'eponge', 'sac poubelle', 'aluminium', 'film alimentaire', 'cartouche', 'ampoule', 'abat jour', 'pile',
    'croquette', 'patee', 'litiere',
  ],
}

/** Words that decide the aisle wherever they are: "haricots verts surgelés", "thon en boîte". */
const OVERRIDES: [Aisle, string[]][] = [
  ['Surgelés', ['surgele']],
  ['Épicerie', ['en boite', 'en conserve', 'en poudre']],
]

interface Keyword {
  aisle: Aisle
  words: string[]
}

const ALL: Keyword[] = Object.entries(KEYWORDS).flatMap(([aisle, list]) =>
  list.map((k) => ({ aisle: aisle as Aisle, words: k.split(' ') })),
)

function words(label: string) {
  return fold(label).split(/[^a-z0-9=]+/).filter(Boolean)
}

/** A word of the name is this keyword word (or its plural). */
function sameWord(word: string, key: string) {
  if (key.startsWith('=')) return word === key.slice(1)
  return word === key || word === key + 's' || word === key + 'x'
}

/** Position where the keyword's words appear in a row in the name, or -1. */
function wholeWordsAt(name: string[], key: string[]) {
  for (let i = 0; i + key.length <= name.length; i++) {
    if (key.every((k, j) => sameWord(name[i + j], k))) return i
  }
  return -1
}

/** Earliest match wins (the product is named first: "jus d'orange"), then the longest keyword. */
function best(matches: { aisle: Aisle; at: number; length: number }[]): Aisle | null {
  matches.sort((a, b) => a.at - b.at || b.length - a.length)
  return matches[0]?.aisle ?? null
}

/**
 * Best guess of the aisle from a product name, in two steps:
 * 1. whole words (with plurals): "laitue" is not "lait", "veau" is not "eau";
 * 2. if nothing matched, parts of words, for keywords of 4 letters or more
 *    ("chouxfleur", "abricotine"); shorter ones would match almost anything.
 */
export function guessAisle(label: string): Aisle {
  const name = words(label)
  for (const [aisle, keys] of OVERRIDES) {
    if (keys.some((k) => wholeWordsAt(name, k.split(' ')) >= 0)) return aisle
  }

  const whole = ALL.map((k) => ({ aisle: k.aisle, at: wholeWordsAt(name, k.words), length: k.words.join(' ').length }))
  const byWord = best(whole.filter((m) => m.at >= 0))
  if (byWord) return byWord

  const text = name.join(' ')
  const partial = ALL.map((k) => ({ aisle: k.aisle, key: k.words.join(' ').replace(/^=/, '') }))
    .filter((k) => k.key.length >= 4)
    .map((k) => ({ aisle: k.aisle, at: text.indexOf(k.key), length: k.key.length }))
  return best(partial.filter((m) => m.at >= 0)) ?? 'Autre'
}

/** Aisle to show an item in: the one set by hand, else a guess. */
export function aisleOf(item: { aisle: string | null; label: string }): Aisle {
  return (AISLES as readonly string[]).includes(item.aisle ?? '') ? (item.aisle as Aisle) : guessAisle(item.label)
}
