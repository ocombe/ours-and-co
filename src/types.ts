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
  /** Only for the girls: not counted in the meals to cover. */
  kids_only: boolean
  season: Season
  effort: Effort | null
  favorite: boolean
  to_review: boolean
  notes: string | null
  link: string | null
  aliases: string[]
  familywall_box: string[]
}

/** Dish plus how often and how recently it was eaten (from history). */
export interface DishWithStats extends Dish {
  times: number
  /** Weeks since it was last eaten; null if never. Estimated for FamilyWall imports. */
  weeksAgo: number | null
}

/** Which meals a menu item covers. `kids`: the girls only, not counted in the needs. */
export type Kind = 'midi' | 'weekend' | 'soir' | 'kids'

export const KIND_LABEL: Record<Kind, string> = {
  weekend: 'Midis du week-end (à 4)',
  midi: 'Midis de semaine',
  soir: 'Soirs',
  kids: 'Pour les filles',
}

export interface Menu {
  id: number
  starts_on: string
  need_midi: number
  need_weekend: number
  need_soir: number
}

export interface MenuItem {
  id: number
  menu_id: number
  dish_id: number | null
  label: string
  kind: Kind
  meals: number
  eaten: number
  source: 'generated' | 'manual' | 'wish' | 'leftover'
  day: string | null
}

export interface Wish {
  id: number
  dish_id: number
  note: string | null
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

export interface ShoppingList {
  id: number
  name: string
  position: number
}

export interface ListItem {
  id: number
  list_id: number
  label: string
  quantity: string | null
  /** Free note: "bio", "pour la quiche", a brand… */
  note: string | null
  done: boolean
  ingredient_id: number | null
  menu_id: number | null
  aisle: string | null
  /** Member who added it; null when added by Claude or imported. */
  added_by: string | null
  created_at: string
  /** Last change: added, renamed, quantity, aisle, ticked… */
  updated_at: string
}

export interface Member {
  user_id: string
  display_name: string
  avatar_url: string | null
}

export type Location = 'congélateur' | 'frigo' | 'placard'
export const LOCATIONS: Location[] = ['congélateur', 'frigo', 'placard']

export interface ReserveItem {
  id: number
  label: string
  quantity: string | null
  location: Location
  ingredient_id: number | null
}

export interface Ingredient {
  id: number
  name: string
  store: string | null
  aisle?: string | null
}
