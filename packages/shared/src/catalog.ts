import { z } from 'zod';

/** Dish categories. Mirrors the `DishCategory` enum in the Prisma schema. */
export const DISH_CATEGORIES = ['STARTER', 'MAIN', 'SNACK', 'PIZZA', 'DESSERT', 'DRINK'] as const;
export const dishCategorySchema = z.enum(DISH_CATEGORIES);
export type DishCategory = z.infer<typeof dishCategorySchema>;

/** Dietary tags a dish can carry. Stored as `String[]` in `Dish.dietaryTags`. */
export const DIETARY_TAGS = [
  'vegetarian',
  'vegan',
  'gluten_free',
  'lactose_free',
  'spicy',
  'high_protein',
  'light',
] as const;
export const dietaryTagSchema = z.enum(DIETARY_TAGS);
export type DietaryTag = z.infer<typeof dietaryTagSchema>;

/** Allergens a dish can contain. Stored as `String[]` in `Dish.allergens`. */
export const ALLERGENS = [
  'gluten',
  'lactose',
  'peanut',
  'nuts',
  'shellfish',
  'fish',
  'egg',
  'soy',
] as const;
export const allergenSchema = z.enum(ALLERGENS);
export type Allergen = z.infer<typeof allergenSchema>;

/** Labels shown to users and used in embedding texts (pt-BR). */
export const DISH_CATEGORY_LABELS: Record<DishCategory, string> = {
  STARTER: 'Entrada',
  MAIN: 'Prato principal',
  SNACK: 'Lanche',
  PIZZA: 'Pizza',
  DESSERT: 'Sobremesa',
  DRINK: 'Bebida',
};

export const DIETARY_TAG_LABELS: Record<DietaryTag, string> = {
  vegetarian: 'vegetariano',
  vegan: 'vegano',
  gluten_free: 'sem glúten',
  lactose_free: 'sem lactose',
  spicy: 'picante',
  high_protein: 'rico em proteína',
  light: 'leve',
};

export const ALLERGEN_LABELS: Record<Allergen, string> = {
  gluten: 'glúten',
  lactose: 'lactose',
  peanut: 'amendoim',
  nuts: 'castanhas',
  shellfish: 'frutos do mar',
  fish: 'peixe',
  egg: 'ovo',
  soy: 'soja',
};
