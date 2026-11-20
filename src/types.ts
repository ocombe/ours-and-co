export type Moment = 'midi' | 'soir' | 'both' | 'dessert'
export type Season = 'all' | 'winter' | 'summer'
export type Effort = 'quick' | 'normal' | 'long'

export interface Dish {
  id: number
  name: string
  category: string
  usual_moment: Moment
  meals_covered: number
  kids_ok: boolean | null
  season: Season
  effort: Effort | null
  favorite: boolean
  to_review: boolean
  notes: string | null
  link: string | null
  aliases: string[]
  familywall_box: string[]
}

/** Dish plus how often it was eaten (from history). */
export interface DishWithStats extends Dish {
  times: number
}

export const CATEGORIES = [
  'volaille',
  'porc',
  'boeuf',
  'veau/agneau',
  'poisson',
  'végétarien',
  'mixte',
  'salade',
  'soupe',
  'sucré',
] as const

export const MOMENT_LABEL: Record<Moment, string> = {
  midi: 'Midi',
  soir: 'Soir',
  both: 'Midi ou soir',
  dessert: 'Dessert',
}

export const SEASON_LABEL: Record<Season, string> = {
  all: 'Toute l’année',
  winter: 'Hiver',
  summer: 'Été',
}

export const EFFORT_LABEL: Record<Effort, string> = {
  quick: 'Rapide',
  normal: 'Normal',
  long: 'Long à faire',
}
