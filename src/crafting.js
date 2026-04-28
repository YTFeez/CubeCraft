/**
 * Système de craft type Minecraft : recettes façonnées (3×3) et sans forme.
 * Les recettes façonnées acceptent le décalage dans la grille (trim) et le
 * miroir horizontal (comportement vanilla), mais PAS les rotations.
 */

import { BLOCK } from './blocks.js';

const STACK_MAX = 64;

/** @typedef {{ id: number, count: number }} Stack */
/** @typedef {{ type: 'shaped', id: string, pattern: string[], keys: Record<string, number>, result: Stack } | { type: 'shapeless', id: string, ingredients: { id: number, count: number }[], result: Stack }} Recipe */

/** @type {Recipe[]} */
export const RECIPES = [
  // Planches : 1 bûche -> 4 (sans forme, une case suffit dans la grille 3×3)
  {
    type: 'shapeless',
    id: 'planks_from_wood',
    ingredients: [{ id: BLOCK.WOOD, count: 1 }],
    result: { id: BLOCK.PLANKS, count: 4 },
  },
  // Bâtons : 2 planches en colonne (façonné vanilla).
  {
    type: 'shaped',
    id: 'sticks',
    pattern: ['P  ', 'P  ', '   '],
    keys: { P: BLOCK.PLANKS },
    result: { id: BLOCK.STICK, count: 4 },
  },
  // Pioches (motif Minecraft classique)
  {
    type: 'shaped',
    id: 'pick_wood',
    pattern: ['PPP', ' S ', ' S '],
    keys: { P: BLOCK.PLANKS, S: BLOCK.STICK },
    result: { id: BLOCK.WOODEN_PICKAXE, count: 1 },
  },
  {
    type: 'shaped',
    id: 'pick_stone',
    pattern: ['RRR', ' S ', ' S '],
    keys: { R: BLOCK.STONE, S: BLOCK.STICK },
    result: { id: BLOCK.STONE_PICKAXE, count: 1 },
  },
  {
    type: 'shaped',
    id: 'pick_iron',
    pattern: ['III', ' S ', ' S '],
    keys: { I: BLOCK.IRON_INGOT, S: BLOCK.STICK },
    result: { id: BLOCK.IRON_PICKAXE, count: 1 },
  },
  {
    type: 'shaped',
    id: 'pick_diamond',
    pattern: ['DDD', ' S ', ' S '],
    keys: { D: BLOCK.DIAMOND, S: BLOCK.STICK },
    result: { id: BLOCK.DIAMOND_PICKAXE, count: 1 },
  },
  // Lingots (compression 2 minerais -> 1 lingot, sans four pour rester jouable)
  {
    type: 'shapeless',
    id: 'iron_ingot',
    ingredients: [{ id: BLOCK.IRON_ORE, count: 2 }],
    result: { id: BLOCK.IRON_INGOT, count: 1 },
  },
  {
    type: 'shapeless',
    id: 'gold_ingot',
    ingredients: [{ id: BLOCK.GOLD_ORE, count: 2 }],
    result: { id: BLOCK.GOLD_INGOT, count: 1 },
  },
];

// ---------------------------------------------------------------------------
// Inventaire : comptage / prélèvement
// ---------------------------------------------------------------------------

/** @param {(Stack|null)[]} slots */
export function countInSlots(slots) {
  const m = new Map();
  for (const s of slots) {
    if (!s || !isFinite(s.count) || s.count <= 0) continue;
    m.set(s.id, (m.get(s.id) || 0) + s.count);
  }
  return m;
}

/**
 * @param {(Stack|null)[]} slots inventaire 36 cases
 * @param {(Stack|null)[]} craft 9 cases de la grille
 * @param {Map<number, number>} need
 */
export function hasIngredients(slots, craft, need) {
  const merged = new Map(countInSlots(slots));
  for (const [id, c] of countInSlots(craft)) {
    merged.set(id, (merged.get(id) || 0) + c);
  }
  for (const [id, n] of need) {
    if ((merged.get(id) || 0) < n) return false;
  }
  return true;
}

/** Prélève `count` unités de `id` dans slots (priorité hotbar puis inventaire). */
export function takeFromSlots(slots, id, count) {
  let rem = count;
  for (let i = 0; i < slots.length && rem > 0; i++) {
    const s = slots[i];
    if (!s || s.id !== id || !isFinite(s.count)) continue;
    const t = Math.min(s.count, rem);
    s.count -= t;
    rem -= t;
    if (s.count <= 0) slots[i] = null;
  }
  return rem === 0;
}

/** Fusionne une stack dans slots (36). */
export function mergeIntoSlots(slots, stack) {
  if (!stack || !isFinite(stack.count) || stack.count <= 0) return;
  let rem = stack.count;
  const id = stack.id;
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

function flatExpected(recipe) {
  /** @type {(number|null)[]} */
  const exp = new Array(9).fill(null);
  for (let r = 0; r < 3; r++) {
    const line = (recipe.pattern[r] || '   ').padEnd(3, ' ');
    for (let c = 0; c < 3; c++) {
      const ch = line[c];
      const idx = r * 3 + c;
      if (ch === ' ' || ch === '.') exp[idx] = null;
      else {
        const id = recipe.keys[ch];
        if (typeof id !== 'number') exp[idx] = null;
        else exp[idx] = id;
      }
    }
  }
  return exp;
}

// ---------------------------------------------------------------------------
// Motifs façonnés : symétries + placement dans la grille 3×3
// ---------------------------------------------------------------------------

/** Liste des cases non vides du motif 3×3 : { r, c, id } (coordonnées 0..2). */
function patternCells(recipe) {
  const expected = flatExpected(recipe);
  const cells = [];
  for (let i = 0; i < 9; i++) {
    const id = expected[i];
    if (id == null) continue;
    cells.push({ r: (i / 3) | 0, c: i % 3, id });
  }
  return cells;
}

function normCells(cells) {
  if (!cells.length) return [];
  const r0 = Math.min(...cells.map(x => x.r));
  const c0 = Math.min(...cells.map(x => x.c));
  return cells.map(({ r, c, id }) => ({ r: r - r0, c: c - c0, id }));
}

function bboxSize(cells) {
  const h = Math.max(0, ...cells.map(x => x.r)) + 1;
  const w = Math.max(0, ...cells.map(x => x.c)) + 1;
  return { h, w };
}

function flipHCellsNorm(cells) {
  const w = bboxSize(cells).w;
  return normCells(cells.map(({ r, c, id }) => ({ r, c: w - 1 - c, id })));
}

/** 2 variantes vanilla : original + miroir horizontal, dédupliquées. */
function cellPatternVariants(baseNorm) {
  const seen = new Set();
  const out = [];
  const key = (cells) => cells.map(x => `${x.r},${x.c},${x.id}`).sort().join(';');
  const variants = [baseNorm, flipHCellsNorm(baseNorm)];
  for (const v of variants) {
    const k = key(v);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(v.map(x => ({ ...x })));
    }
  }
  return out;
}

/** @returns {{ dr: number, dc: number, cells: { r: number, c: number, id: number }[] } | null} */
function tryPlacementDetails(craftGrid, cells) {
  if (!cells.length) return null;
  const ph = Math.max(...cells.map(x => x.r)) + 1;
  const pw = Math.max(...cells.map(x => x.c)) + 1;
  for (let dr = 0; dr + ph <= 3; dr++) {
    for (let dc = 0; dc + pw <= 3; dc++) {
      let ok = true;
      for (let r = 0; r < 3 && ok; r++) {
        for (let c = 0; c < 3; c++) {
          const pr = r - dr;
          const pc = c - dc;
          const need = cells.find(x => x.r === pr && x.c === pc);
          const s = craftGrid[r * 3 + c];
          if (need) {
            if (!s || s.id !== need.id || s.count < 1) ok = false;
          } else if (s && s.count > 0) ok = false;
        }
      }
      if (ok) return { dr, dc, cells };
    }
  }
  return null;
}

function findShapedMatchDetails(craftGrid, recipe) {
  const base = normCells(patternCells(recipe));
  if (!base.length) return null;
  for (const variant of cellPatternVariants(base)) {
    const det = tryPlacementDetails(craftGrid, variant);
    if (det) return det;
  }
  return null;
}

/**
 * @param {(Stack|null)[]} craftGrid
 * @param {Extract<Recipe, { type: 'shaped' }>} recipe
 */
function matchesShaped(craftGrid, recipe) {
  return findShapedMatchDetails(craftGrid, recipe) != null;
}

/**
 * @param {(Stack|null)[]} craftGrid
 */
function matchesShapeless(craftGrid, recipe) {
  const need = new Map();
  for (const ing of recipe.ingredients) {
    need.set(ing.id, (need.get(ing.id) || 0) + ing.count);
  }
  const have = new Map();
  for (const s of craftGrid) {
    if (!s || !isFinite(s.count) || s.count <= 0) continue;
    have.set(s.id, (have.get(s.id) || 0) + s.count);
  }
  let sumNeed = 0, sumHave = 0;
  for (const v of need.values()) sumNeed += v;
  for (const v of have.values()) sumHave += v;
  if (sumNeed !== sumHave) return false;
  for (const [id, n] of need) {
    if ((have.get(id) || 0) !== n) return false;
  }
  return true;
}

/**
 * @param {(Stack|null)[]} craftGrid
 * @returns {Recipe | null}
 */
export function findMatchingRecipe(craftGrid) {
  /** @type {Recipe | null} */
  let found = null;
  for (const r of RECIPES) {
    if (r.type === 'shaped' && matchesShaped(craftGrid, r)) {
      // En cas de collision théorique, la première dans la liste gagne (ordre déterministe).
      if (!found) found = r;
    } else if (r.type === 'shapeless' && matchesShapeless(craftGrid, r)) {
      if (!found) found = r;
    }
  }
  return found;
}

/**
 * Consomme la recette correspondant à la grille actuelle et ajoute le résultat dans `slots`.
 * @param {(Stack|null)[]} craftGrid
 * @param {(Stack|null)[]} slots inventaire 36
 * @param {Recipe} recipe
 */
export function craftOnceFromGrid(craftGrid, slots, recipe) {
  if (recipe.type === 'shapeless') {
    for (const ing of recipe.ingredients) {
      let rem = ing.count;
      for (let i = 0; i < 9 && rem > 0; i++) {
        const s = craftGrid[i];
        if (!s || s.id !== ing.id) continue;
        const t = Math.min(s.count, rem);
        s.count -= t;
        rem -= t;
        if (s.count <= 0) craftGrid[i] = null;
      }
      if (rem > 0) return false;
    }
  } else {
    const det = findShapedMatchDetails(craftGrid, recipe);
    if (!det) return false;
    for (const cell of det.cells) {
      const i = (det.dr + cell.r) * 3 + (det.dc + cell.c);
      const s = craftGrid[i];
      if (!s || s.id !== cell.id || s.count < 1) return false;
    }
    for (const cell of det.cells) {
      const i = (det.dr + cell.r) * 3 + (det.dc + cell.c);
      const s = craftGrid[i];
      s.count -= 1;
      if (s.count <= 0) craftGrid[i] = null;
    }
  }
  mergeIntoSlots(slots, recipe.result);
  return true;
}

/** Besoin total d'objets pour placer une recette façonnée dans la grille (sans compter la grille). */
function shapedNeeds(recipe) {
  const m = new Map();
  const exp = flatExpected(recipe);
  for (const id of exp) {
    if (id == null) continue;
    m.set(id, (m.get(id) || 0) + 1);
  }
  return m;
}

function shapelessNeeds(recipe) {
  const m = new Map();
  for (const ing of recipe.ingredients) {
    m.set(ing.id, (m.get(ing.id) || 0) + ing.count);
  }
  return m;
}

export function recipeIngredientMap(recipe) {
  return recipe.type === 'shaped' ? shapedNeeds(recipe) : shapelessNeeds(recipe);
}

/**
 * Vide la grille vers l'inventaire puis, si possible, place les ingrédients depuis l'inventaire.
 * @returns {boolean}
 */
export function fillRecipeFromInventory(slots, craftGrid, recipe) {
  // renvoie tout de la grille vers l'inventaire
  for (let i = 0; i < 9; i++) {
    const s = craftGrid[i];
    if (!s) continue;
    mergeIntoSlots(slots, s);
    craftGrid[i] = null;
  }
  const need = recipeIngredientMap(recipe);
  if (!hasIngredients(slots, craftGrid, need)) return false;

  if (recipe.type === 'shaped') {
    const expected = flatExpected(recipe);
    for (let i = 0; i < 9; i++) {
      const id = expected[i];
      if (id == null) continue;
      if (!takeFromSlots(slots, id, 1)) return false;
      craftGrid[i] = { id, count: 1 };
    }
  } else {
    for (const ing of recipe.ingredients) {
      let rem = ing.count;
      while (rem > 0) {
        if (!takeFromSlots(slots, ing.id, 1)) return false;
        let placed = false;
        for (let i = 0; i < 9 && !placed; i++) {
          if (craftGrid[i]) continue;
          craftGrid[i] = { id: ing.id, count: 1 };
          placed = true;
        }
        rem--;
      }
    }
  }
  return true;
}
