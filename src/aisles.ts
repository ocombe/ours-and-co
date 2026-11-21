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

// First matching keyword wins (folded: lowercase, no accents).
const KEYWORDS: [Aisle, string[]][] = [
  ['Surgelés', ['surgele', 'glace', 'picard']],
  // Grocery products named after a fruit or vegetable ("chocolat à l'orange", "coulis de tomate").
  ['Épicerie', ['chocolat', 'coulis', 'sauce', 'confiture', 'biscuit', 'conserve', 'en boite', 'pate a ', 'pate brisee', 'pate feuilletee', 'compote']],
  ['Poissonnerie', ['saumon', 'cabillaud', 'lieu', 'dorade', 'sole', 'merlu', 'poisson', 'crevette', 'moule', 'thon frais', 'eglefin']],
  [
    'Boucherie & volaille',
    ['poulet', 'dinde', 'boeuf', 'steak', 'veau', 'porc', 'agneau', 'roti', 'saucisse', 'lardon', 'jambon', 'cordon bleu', 'caillette', 'magret', 'canard', 'lapin', 'chipolata', 'merguez', 'filet mignon', 'escalope', 'cote', 'hache', 'quenelle', 'saucisson'],
  ],
  [
    'Crèmerie & fromages',
    ['oeuf', 'lait', 'beurre', 'creme', 'yaourt', 'fromage', 'comte', 'chevre', 'emmental', 'gruyere', 'parmesan', 'mozzarella', 'kiri', 'raclette', 'reblochon', 'cancoillotte', 'mascarpone', 'ricotta', 'burrata', 'feta'],
  ],
  ['Boulangerie', ['pain', 'baguette', 'brioche', 'viennoiserie', 'croissant']],
  [
    'Fruits & légumes',
    ['salade', 'carotte', 'tomate', 'courge', 'butternut', 'potimarron', 'courgette', 'aubergine', 'poivron', 'oignon', 'ail', 'echalote', 'poireau', 'endive', 'epinard', 'chou', 'brocoli', 'haricot vert', 'betterave', 'champignon', 'pomme de terre', 'patate', 'avocat', 'banane', 'pomme', 'poire', 'clementine', 'orange', 'citron', 'kiwi', 'fraise', 'framboise', 'raisin', 'melon', 'peche', 'abricot', 'cresson', 'blette', 'navet', 'radis', 'concombre', 'herbe', 'persil', 'basilic', 'legume', 'fruit'],
  ],
  ['Boissons', ['eau', 'jus', 'vin', 'biere', 'sirop', 'soda', 'cafe', 'the ']],
  [
    'Hygiène & maison',
    ['javel', 'lingette', 'savon', 'shampo', 'dentifrice', 'lessive', 'papier', 'eponge', 'sac poubelle', 'sopalin', 'mouchoir', 'cartouche', 'ampoule', 'abat jour', 'pile'],
  ],
  [
    'Épicerie',
    ['pate', 'riz', 'farine', 'sucre', 'sel', 'huile', 'vinaigre', 'conserve', 'boite', 'coulis', 'sauce', 'nouille', 'tagliatelle', 'penne', 'macaroni', 'spaghetti', 'gnocchi', 'ravioli', 'semoule', 'lentille', 'pois chiche', 'chocolat', 'biscuit', 'cereale', 'confiture', 'miel', 'epice', 'moutarde', 'mayonnaise', 'mais', 'thon'],
  ],
]

/** Best guess of the aisle from a product name. */
export function guessAisle(label: string): Aisle {
  const f = ' ' + fold(label) + ' '
  for (const [aisle, words] of KEYWORDS) {
    if (words.some((w) => f.includes(w))) return aisle
  }
  return 'Autre'
}

/** Aisle to show an item in: the one set by hand, else a guess. */
export function aisleOf(item: { aisle: string | null; label: string }): Aisle {
  return (AISLES as readonly string[]).includes(item.aisle ?? '') ? (item.aisle as Aisle) : guessAisle(item.label)
}
