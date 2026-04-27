// Shapeless crafting: each recipe is { id, count, ingredients: Map<blockId, count> }.
// The client checks the player's full inventory (36 slots) for ingredients.

import { BLOCK } from './blocks.js';

export const CRAFT_RECIPES = [
  {
    id: 'sticks',
    out: { id: BLOCK.STICK, count: 4 },
    ingredients: new Map([[BLOCK.PLANKS, 2]]),
  },
  {
    id: 'wood_pick',
    out: { id: BLOCK.WOODEN_PICKAXE, count: 1 },
    ingredients: new Map([[BLOCK.PLANKS, 3], [BLOCK.STICK, 2]]),
  },
  {
    id: 'stone_pick',
    out: { id: BLOCK.STONE_PICKAXE, count: 1 },
    ingredients: new Map([[BLOCK.STONE, 3], [BLOCK.STICK, 2]]),
  },
  {
    id: 'iron_ingot',
    out: { id: BLOCK.IRON_INGOT, count: 1 },
    ingredients: new Map([[BLOCK.IRON_ORE, 2]]),
  },
  {
    id: 'iron_pick',
    out: { id: BLOCK.IRON_PICKAXE, count: 1 },
    ingredients: new Map([[BLOCK.IRON_INGOT, 3], [BLOCK.STICK, 2]]),
  },
  {
    id: 'gold_ingot',
    out: { id: BLOCK.GOLD_INGOT, count: 1 },
    ingredients: new Map([[BLOCK.GOLD_ORE, 2]]),
  },
  {
    id: 'diamond_pick',
    out: { id: BLOCK.DIAMOND_PICKAXE, count: 1 },
    ingredients: new Map([[BLOCK.DIAMOND, 3], [BLOCK.STICK, 2]]),
  },
];

/**
 * @param {Array<{id:number,count:number}|null>} slots 36 slots
 * @returns {boolean}
 */
export function canCraft(slots, recipe) {
  const counts = countItems(slots);
  for (const [bid, need] of recipe.ingredients) {
    if ((counts.get(bid) || 0) < need) return false;
  }
  return true;
}

/**
 * Mutates slots: removes ingredients, adds output (merging stacks). Returns false if cannot.
 */
export function craftInto(slots, recipe) {
  if (!canCraft(slots, recipe)) return false;
  const counts = countItems(slots);
  for (const [bid, need] of recipe.ingredients) {
    let rem = need;
    for (let i = 0; i < slots.length && rem > 0; i++) {
      const s = slots[i];
      if (!s || s.id !== bid || !isFinite(s.count)) continue;
      const take = Math.min(s.count, rem);
      s.count -= take;
      rem -= take;
      if (s.count <= 0) slots[i] = null;
    }
  }
  const { id, count } = recipe.out;
  addStacked(slots, id, count);
  return true;
}

function countItems(slots) {
  const m = new Map();
  for (const s of slots) {
    if (!s || !isFinite(s.count) || s.count <= 0) continue;
    m.set(s.id, (m.get(s.id) || 0) + s.count);
  }
  return m;
}

const STACK_MAX = 64;

function addStacked(slots, id, qty) {
  let rem = qty;
  for (let i = 0; i < slots.length && rem > 0; i++) {
    const s = slots[i];
    if (s && s.id === id && s.count < STACK_MAX) {
      const room = STACK_MAX - s.count;
      const add = Math.min(room, rem);
      s.count += add;
      rem -= add;
    }
  }
  for (let i = 0; i < slots.length && rem > 0; i++) {
    if (!slots[i]) {
      const add = Math.min(STACK_MAX, rem);
      slots[i] = { id, count: add };
      rem -= add;
    }
  }
}
