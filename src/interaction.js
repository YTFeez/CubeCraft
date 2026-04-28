import * as THREE from 'three';
import {
  BLOCK, HOTBAR_BLOCKS, BLOCK_INFO, isSolid, isFluidSource, blockIconDataURL,
  breakTimeSeconds, canHarvestBlock, dropIdForBlock, isPlaceable,
} from './blocks.js';
import {
  RECIPES,
  hasIngredients,
  recipeIngredientMap,
  fillRecipeFromInventory,
  findMatchingRecipe,
  craftOnceFromGrid,
  mergeIntoSlots,
} from './crafting.js';

const REACH = 6;
const HOTBAR_SIZE = 9;
const MAIN_SIZE = 27;
const INV_SIZE = HOTBAR_SIZE + MAIN_SIZE; // 36 slots: 0..8 hotbar, 9..35 main
const STACK_MAX = 64;
const CRAFT_GRID_SIZE = 2;
const CRAFT_SLOT_COUNT = CRAFT_GRID_SIZE * CRAFT_GRID_SIZE;

// Blocks the player cannot pick up when broken (fluids included so we never
// stash a flowing-water block in the inventory).
const NO_DROP = new Set([
  BLOCK.BEDROCK, BLOCK.WATER, BLOCK.LAVA, BLOCK.WATER_FLOW, BLOCK.LAVA_FLOW,
]);

// Blocks shown in the creative palette inside the inventory overlay (creative
// mode only). Sources/flowing fluids and bedrock are hidden because the player
// cannot place them anyway.
const CREATIVE_PALETTE = [
  BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.SAND,
  BLOCK.WOOD, BLOCK.PLANKS, BLOCK.LEAVES, BLOCK.GLASS,
  BLOCK.SNOW, BLOCK.ICE, BLOCK.CACTUS, BLOCK.OBSIDIAN,
];

export class Interaction {
  constructor({ camera, world, player, scene, atlasCanvas, audio, onChange, onBreak, onEdit, onSlot, onInventoryChange, onDropItem, hotbar, initialSlot, mode, initialInventory }) {
    this.camera = camera;
    this.world = world;
    this.player = player;
    this.scene = scene;
    this.audio = audio;
    this.atlasCanvas = atlasCanvas;
    this.onChange = onChange;
    this.onBreak = onBreak;
    this.onEdit = onEdit;
    this.onSlot = onSlot;
    this.onInventoryChange = onInventoryChange;
    this.onDropItem = onDropItem;
    this.mode = mode === 'survival' ? 'survival' : 'creative';
    this._defaultHotbar = (hotbar && hotbar.length ? hotbar : HOTBAR_BLOCKS).slice(0, HOTBAR_SIZE);

    this.slots = this._buildInitialSlots(initialInventory);
    this.selectedIndex = Math.max(0, Math.min(HOTBAR_SIZE - 1, initialSlot | 0));

    // Slot held by the cursor while the inventory overlay is open.
    this.carried = null; // { id, count } | null
    this.invOpen = false;
    this.activeInvTab = 'inventory';

    /** @type {({ id: number, count: number } | null)[] | null} Grille 3×3 (survie uniquement). */
    this.craftGrid = this.mode === 'survival' ? new Array(CRAFT_SLOT_COUNT).fill(null) : null;

    /** @type {{ x:number,y:number,z:number,id:number,progress:number } | null} */
    this._mining = null;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = REACH;

    this._buildHotbarDOM();
    this._buildInventoryDOM();
    this._buildHighlight();

    window.addEventListener('wheel', e => this._onWheel(e), { passive: true });
    window.addEventListener('keydown', e => this._onKeyDown(e));
    window.addEventListener('mousedown', e => this._onMouseDown(e));
    window.addEventListener('mouseup', e => this._onMouseUp(e));
    window.addEventListener('mouseleave', () => this._cancelMining());
    window.addEventListener('mousemove', e => this._onMouseMove(e));
    window.addEventListener('contextmenu', (e) => {
      // Prevent browser context menu while inventory is open so right-click
      // split/place behaves exactly like in-game.
      if (this.invOpen) e.preventDefault();
    });
  }

  _buildInitialSlots(saved) {
    const slots = new Array(INV_SIZE).fill(null);
    if (this.mode === 'creative') {
      // In creative the hotbar is pre-filled with the theme's defaults; the
      // main inventory stays empty (the creative palette gives unlimited stacks
      // on demand).
      this._defaultHotbar.forEach((id, i) => {
        if (i < HOTBAR_SIZE) slots[i] = { id, count: Infinity };
      });
      return slots;
    }
    // Survival: restore from saved snapshot if available. Backwards compatible
    // with old 9-slot saves (they fill the hotbar only).
    if (Array.isArray(saved)) {
      const n = Math.min(saved.length, INV_SIZE);
      for (let i = 0; i < n; i++) {
        const s = saved[i];
        if (s && typeof s.id === 'number' && s.id !== BLOCK.AIR && (s.count | 0) > 0) {
          slots[i] = { id: s.id, count: Math.min(STACK_MAX, s.count | 0) };
        }
      }
    }
    // Premier monde / nouveau joueur : kit de départ survie (pioche + bois pour crafter).
    const hasAnything = slots.some(s => s && isFinite(s.count) && s.count > 0);
    if (!hasAnything) {
      slots[0] = { id: BLOCK.WOODEN_PICKAXE, count: 1 };
      slots[1] = { id: BLOCK.PLANKS, count: 12 };
      slots[2] = { id: BLOCK.WOOD, count: 8 };
      slots[3] = { id: BLOCK.STICK, count: 4 };
    }
    return slots;
  }

  exportInventory() {
    return this.slots.map(s => (s ? { id: s.id, count: isFinite(s.count) ? s.count : 0 } : null));
  }

  // ---------------------------------------------------------------------------
  // Hotbar (always visible, shows slots 0..8)
  // ---------------------------------------------------------------------------
  _buildHotbarDOM() {
    const bar = document.getElementById('hotbar');
    bar.innerHTML = '';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot' + (i === this.selectedIndex ? ' active' : '');
      slot.dataset.index = i;
      const key = document.createElement('div');
      key.className = 'key';
      key.textContent = (i + 1);
      const icon = document.createElement('div');
      icon.className = 'icon';
      const count = document.createElement('div');
      count.className = 'count';
      slot.appendChild(key);
      slot.appendChild(icon);
      slot.appendChild(count);
      slot.addEventListener('click', () => this.select(i));
      bar.appendChild(slot);
    }
    this._refreshHotbarDOM();
  }

  _refreshHotbarDOM() {
    const slots = document.querySelectorAll('#hotbar .slot');
    slots.forEach((el, i) => {
      const data = this.slots[i];
      const icon = el.querySelector('.icon');
      const count = el.querySelector('.count');
      el.classList.toggle('active', i === this.selectedIndex);
      el.classList.toggle('empty', !data);
      if (data) {
        icon.style.backgroundImage = `url(${blockIconDataURL(data.id, this.atlasCanvas)})`;
        icon.style.backgroundSize = 'cover';
        el.classList.toggle('tool-slot', BLOCK_INFO[data.id]?.placeable === false);
        el.title = BLOCK_INFO[data.id]?.name || '';
        if (this.mode === 'survival' && isFinite(data.count)) {
          count.textContent = data.count > 1 ? data.count : '';
        } else {
          count.textContent = '';
        }
      } else {
        icon.style.backgroundImage = 'none';
        el.classList.remove('tool-slot');
        el.title = '';
        count.textContent = '';
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Full inventory overlay (E to toggle)
  // ---------------------------------------------------------------------------
  _buildInventoryDOM() {
    let overlay = document.getElementById('inventory');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'inventory';
      overlay.className = 'overlay hidden inventory-overlay';
      overlay.innerHTML = `
        <div class="inv-panel">
          <div class="inv-tabs" id="inv-tabs">
            <button type="button" class="inv-tab active" data-tab="inventory">Inventaire</button>
            <button type="button" class="inv-tab" data-tab="recipes">Livre recettes</button>
            <button type="button" class="inv-tab" data-tab="faction">Faction</button>
            <button type="button" class="inv-tab" data-tab="shop">Shop</button>
          </div>
          <div class="inv-pages">
            <section class="inv-page active" data-tab="inventory">
              <h2>Inventaire</h2>
              <div id="inv-craft" class="inv-craft hidden"></div>
              <div class="inv-grid" id="inv-main"></div>
              <div class="inv-sep"></div>
              <div class="inv-hotbar" id="inv-hotbar"></div>
              <div class="inv-palette-wrap hidden" id="inv-palette-wrap">
                <div class="inv-palette-title">Palette créative — clic pour prendre un stack de 64</div>
                <div class="inv-palette" id="inv-palette"></div>
              </div>
              <p class="hint">E ou Échap pour fermer · Clic gauche : prendre/déposer le stack · Clic droit : déposer 1 / prendre la moitié · Maj+clic : auto-rangement</p>
            </section>

            <section class="inv-page" data-tab="recipes">
              <h2>Livre de recettes</h2>
              <div class="recipe-book-list inv-recipes-list" id="inv-recipe-book-tab"></div>
            </section>

            <section class="inv-page" data-tab="faction">
              <h2>Faction</h2>
              <div class="inv-placeholder-card">
                <p>Gestion de faction (grade, membres, alliances) prete pour branchement serveur.</p>
                <button type="button" class="secondary">Creer une faction</button>
              </div>
            </section>

            <section class="inv-page" data-tab="shop">
              <h2>Shop</h2>
              <div class="inv-placeholder-card">
                <p>Boutique en jeu : achats/ventes, economie et prix dynamiques.</p>
                <button type="button" class="secondary">Ouvrir la boutique</button>
              </div>
            </section>
          </div>
        </div>
        <div class="inv-cursor" id="inv-cursor"></div>
      `;
      document.body.appendChild(overlay);

      overlay.querySelectorAll('.inv-tab').forEach(btn => {
        btn.addEventListener('click', () => this._setInventoryTab(btn.dataset.tab || 'inventory'));
      });
    }
    this._invOverlayEl = overlay;
    this._invMainEl = overlay.querySelector('#inv-main');
    this._invHotbarEl = overlay.querySelector('#inv-hotbar');
    this._invPaletteWrap = overlay.querySelector('#inv-palette-wrap');
    this._invPaletteEl = overlay.querySelector('#inv-palette');
    this._invCursorEl = overlay.querySelector('#inv-cursor');
    this._invRecipeBookEl = overlay.querySelector('#inv-recipe-book-tab');

    // Build empty slot grid (main 27 then hotbar 9). We render hotbar twice:
    // the bottom row of the inventory grid mirrors the live hotbar so the
    // player can drag stacks onto specific number keys.
    this._invMainEl.innerHTML = '';
    for (let i = HOTBAR_SIZE; i < INV_SIZE; i++) {
      this._invMainEl.appendChild(this._buildInvSlotEl(i));
    }
    this._invHotbarEl.innerHTML = '';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      this._invHotbarEl.appendChild(this._buildInvSlotEl(i));
    }

    // Creative palette (only visible in creative mode).
    this._invPaletteEl.innerHTML = '';
    if (this.mode === 'creative') {
      this._invPaletteWrap.classList.remove('hidden');
      for (const id of CREATIVE_PALETTE) {
        const tile = document.createElement('div');
        tile.className = 'inv-slot palette-slot';
        tile.title = BLOCK_INFO[id]?.name || '';
        const icon = document.createElement('div');
        icon.className = 'inv-icon';
        icon.style.backgroundImage = `url(${blockIconDataURL(id, this.atlasCanvas)})`;
        icon.style.backgroundSize = 'cover';
        tile.appendChild(icon);
        tile.addEventListener('mousedown', (e) => {
          e.preventDefault();
          // Always replace the carried stack with a fresh creative stack.
          this.carried = { id, count: 64 };
          this._refreshInventoryDOM();
        });
        this._invPaletteEl.appendChild(tile);
      }
    } else {
      this._invPaletteWrap.classList.add('hidden');
    }

    this._invCraftEl = overlay.querySelector('#inv-craft');
    if (!this._invCraftEl) {
      const panel = overlay.querySelector('.inv-panel');
      const hint = panel?.querySelector('.hint');
      if (panel && hint) {
        const craft = document.createElement('div');
        craft.id = 'inv-craft';
        craft.className = 'inv-craft';
        panel.insertBefore(craft, hint);
        this._invCraftEl = craft;
      }
    }
    this._buildCraftingList();
    this._buildRecipeBookTab();
    this._setInventoryTab(this.activeInvTab);

    // Click outside the panel: drop the carried stack back into the world.
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) {
        // Click on the dim background only — discard carried back to inventory
        // by trying to auto-place it in the first available slot.
        if (this.carried) {
          this._autoStow(this.carried);
          this.carried = null;
          this._refreshInventoryDOM();
        }
      }
    });
  }

  _stowCraftGrid() {
    if (!this.craftGrid) return;
    for (let i = 0; i < this.craftGrid.length; i++) {
      const s = this.craftGrid[i];
      if (!s) continue;
      mergeIntoSlots(this.slots, s);
      this.craftGrid[i] = null;
    }
  }

  _recipeCanFill(recipe) {
    const need = recipeIngredientMap(recipe);
    return hasIngredients(this.slots, this.craftGrid || [], need);
  }

  _setInventoryTab(tab) {
    const safeTab = ['inventory', 'recipes', 'faction', 'shop'].includes(tab) ? tab : 'inventory';
    this.activeInvTab = safeTab;
    if (!this._invOverlayEl) return;
    this._invOverlayEl.querySelectorAll('.inv-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === safeTab);
    });
    this._invOverlayEl.querySelectorAll('.inv-page').forEach(page => {
      page.classList.toggle('active', page.dataset.tab === safeTab);
    });
  }

  _buildRecipeBookTab() {
    const list = this._invRecipeBookEl;
    if (!list) return;
    list.innerHTML = '';
    if (this.mode !== 'survival') {
      const txt = document.createElement('div');
      txt.className = 'inv-placeholder-card';
      txt.textContent = 'Le livre de recettes est disponible en mode survie.';
      list.appendChild(txt);
      return;
    }
    for (const recipe of RECIPES) {
      const row = document.createElement('div');
      row.className = 'recipe-book-row';
      row.dataset.recipeId = recipe.id;
      const icon = document.createElement('div');
      icon.className = 'inv-icon recipe-book-icon';
      icon.style.backgroundImage = `url(${blockIconDataURL(recipe.result.id, this.atlasCanvas)})`;
      icon.style.backgroundSize = 'cover';
      const label = document.createElement('span');
      label.className = 'recipe-book-label';
      const nm = BLOCK_INFO[recipe.result.id]?.name || recipe.id;
      label.textContent = `${nm} ×${recipe.result.count}`;
      row.appendChild(icon);
      row.appendChild(label);
      const can = this._recipeCanFill(recipe);
      row.classList.toggle('recipe-book-row-disabled', !can);
      row.title = can ? 'Clique pour placer les ingredients dans le craft' : 'Objets insuffisants';
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (e.button !== 0 || !this.craftGrid) return;
        if (!this._recipeCanFill(recipe)) return;
        if (!fillRecipeFromInventory(this.slots, this.craftGrid, recipe)) return;
        this._setInventoryTab('inventory');
        this._refreshHotbarDOM();
        this._refreshInventoryDOM();
        this._refreshCraftingDOM();
        this._refreshRecipeBookRows();
        if (this.onInventoryChange) this.onInventoryChange();
      });
      list.appendChild(row);
    }
  }

  _buildCraftingList() {
    const wrap = this._invCraftEl;
    if (!wrap) return;
    wrap.innerHTML = '';
    if (this.mode !== 'survival') {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
    wrap.classList.add('inv-craft-mc');

    const tableCol = document.createElement('div');
    tableCol.className = 'craft-table-col';
    const craftTitle = document.createElement('div');
    craftTitle.className = 'inv-palette-title';
    craftTitle.textContent = 'Craft (cases)';
    tableCol.appendChild(craftTitle);

    const tableRow = document.createElement('div');
    tableRow.className = 'craft-table-row';
    const gridEl = document.createElement('div');
    gridEl.className = `craft-grid-${CRAFT_GRID_SIZE}x${CRAFT_GRID_SIZE}`;
    for (let i = 0; i < this.craftGrid.length; i++) {
      gridEl.appendChild(this._buildCraftSlotEl(i));
    }
    const arrow = document.createElement('div');
    arrow.className = 'craft-arrow';
    arrow.textContent = '→';
    const resultEl = document.createElement('div');
    resultEl.className = 'inv-slot craft-result-slot';
    resultEl.title = 'Clic : fabriquer une fois';
    resultEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (e.button !== 0 || !this.craftGrid) return;
      const recipe = findMatchingRecipe(this.craftGrid);
      if (!recipe) return;
      if (!craftOnceFromGrid(this.craftGrid, this.slots, recipe)) return;
      this._refreshHotbarDOM();
      this._refreshInventoryDOM();
      this._refreshCraftingDOM();
      this._refreshRecipeBookRows();
      if (this.onInventoryChange) this.onInventoryChange();
    });
    tableRow.appendChild(gridEl);
    tableRow.appendChild(arrow);
    tableRow.appendChild(resultEl);
    tableCol.appendChild(tableRow);

    wrap.appendChild(tableCol);
    this._craftResultEl = resultEl;
    this._refreshCraftingDOM();
  }

  _buildCraftSlotEl(i) {
    const el = document.createElement('div');
    el.className = 'inv-slot craft-slot';
    el.dataset.craftIdx = String(i);
    const icon = document.createElement('div');
    icon.className = 'inv-icon';
    const count = document.createElement('div');
    count.className = 'inv-count';
    el.appendChild(icon);
    el.appendChild(count);
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this._onCraftSlotMouseDown(i, e);
    });
    return el;
  }

  _refreshCraftingDOM() {
    if (!this._invCraftEl || !this.craftGrid) return;
    const els = this._invCraftEl.querySelectorAll('.craft-slot[data-craft-idx]');
    els.forEach(el => {
      const i = +el.dataset.craftIdx;
      const s = this.craftGrid[i];
      const icon = el.querySelector('.inv-icon');
      const count = el.querySelector('.inv-count');
      if (s) {
        icon.style.backgroundImage = `url(${blockIconDataURL(s.id, this.atlasCanvas)})`;
        icon.style.backgroundSize = 'cover';
        el.title = BLOCK_INFO[s.id]?.name || '';
        if (isFinite(s.count) && s.count > 1) count.textContent = s.count;
        else count.textContent = '';
      } else {
        icon.style.backgroundImage = 'none';
        el.title = '';
        count.textContent = '';
      }
      el.classList.toggle('empty', !s);
    });
    if (this._craftResultEl) {
      const recipe = findMatchingRecipe(this.craftGrid);
      const icon = this._craftResultEl.querySelector('.inv-icon');
      const count = this._craftResultEl.querySelector('.inv-count');
      if (!icon) {
        const ic = document.createElement('div');
        ic.className = 'inv-icon';
        const ct = document.createElement('div');
        ct.className = 'inv-count';
        this._craftResultEl.appendChild(ic);
        this._craftResultEl.appendChild(ct);
      }
      const icon2 = this._craftResultEl.querySelector('.inv-icon');
      const count2 = this._craftResultEl.querySelector('.inv-count');
      if (recipe) {
        icon2.style.backgroundImage = `url(${blockIconDataURL(recipe.result.id, this.atlasCanvas)})`;
        icon2.style.backgroundSize = 'cover';
        this._craftResultEl.title = `Clic : fabriquer — ${BLOCK_INFO[recipe.result.id]?.name || ''} ×${recipe.result.count}`;
        count2.textContent = recipe.result.count > 1 ? String(recipe.result.count) : '';
        this._craftResultEl.classList.remove('empty');
        this._craftResultEl.classList.add('craft-result-ready');
      } else {
        icon2.style.backgroundImage = 'none';
        count2.textContent = '';
        this._craftResultEl.title = 'Place un motif valide';
        this._craftResultEl.classList.add('empty');
        this._craftResultEl.classList.remove('craft-result-ready');
      }
    }
  }

  _refreshRecipeBookRows() {
    if (!this._invRecipeBookEl) return;
    this._invRecipeBookEl.querySelectorAll('.recipe-book-row').forEach(row => {
      const id = row.dataset.recipeId;
      const recipe = RECIPES.find(r => r.id === id);
      if (!recipe) return;
      const can = this._recipeCanFill(recipe);
      row.classList.toggle('recipe-book-row-disabled', !can);
      row.title = can ? 'Clic : placer les ingrédients dans la grille' : 'Objets insuffisants';
    });
  }

  _onCraftSlotMouseDown(i, e) {
    if (!this.craftGrid) return;
    this._moveInvCursor(e.clientX, e.clientY);
    const s = this.craftGrid[i];
    const carried = this.carried;
    const isLeft = e.button === 0;
    const isRight = e.button === 2;
    const shift = e.shiftKey;

    if (shift && s) {
      let remaining = isFinite(s.count) ? s.count : 64;
      for (let j = 0; j < INV_SIZE && remaining > 0; j++) {
        const t = this.slots[j];
        if (t && t.id === s.id && isFinite(t.count) && t.count < STACK_MAX) {
          const room = STACK_MAX - t.count;
          const add = Math.min(room, remaining);
          t.count += add;
          remaining -= add;
        }
      }
      for (let j = 0; j < INV_SIZE && remaining > 0; j++) {
        if (!this.slots[j]) {
          const add = Math.min(STACK_MAX, remaining);
          this.slots[j] = { id: s.id, count: add };
          remaining -= add;
        }
      }
      if (isFinite(s.count)) {
        s.count = remaining;
        if (s.count <= 0) this.craftGrid[i] = null;
      }
      this._refreshCraftingDOM();
      this._refreshInventoryDOM();
      this._refreshHotbarDOM();
      this._refreshRecipeBookRows();
      if (this.onInventoryChange) this.onInventoryChange();
      return;
    }

    if (isLeft) {
      if (!carried) {
        if (s) {
          this.carried = isFinite(s.count) ? { id: s.id, count: s.count } : { id: s.id, count: 64 };
          this.craftGrid[i] = null;
        }
      } else {
        if (!s) {
          this.craftGrid[i] = carried;
          this.carried = null;
        } else if (s.id === carried.id && isFinite(s.count) && isFinite(carried.count)) {
          const room = STACK_MAX - s.count;
          const add = Math.min(room, carried.count);
          s.count += add;
          carried.count -= add;
          if (carried.count <= 0) this.carried = null;
        } else {
          this.craftGrid[i] = carried;
          this.carried = s;
        }
      }
    } else if (isRight) {
      if (carried) {
        if (!s) {
          this.craftGrid[i] = { id: carried.id, count: 1 };
          if (isFinite(carried.count)) carried.count -= 1;
          if (isFinite(carried.count) && carried.count <= 0) this.carried = null;
        } else if (s.id === carried.id && isFinite(s.count) && s.count < STACK_MAX) {
          s.count += 1;
          if (isFinite(carried.count)) carried.count -= 1;
          if (isFinite(carried.count) && carried.count <= 0) this.carried = null;
        }
      } else if (s && isFinite(s.count) && s.count > 1) {
        const half = Math.ceil(s.count / 2);
        this.carried = { id: s.id, count: half };
        s.count -= half;
        if (s.count <= 0) this.craftGrid[i] = null;
      } else if (s && isFinite(s.count) && s.count === 1) {
        this.carried = { id: s.id, count: 1 };
        this.craftGrid[i] = null;
      } else if (s && !isFinite(s.count)) {
        this.carried = { id: s.id, count: 64 };
      }
    }

    this._refreshCraftingDOM();
    this._refreshInventoryDOM();
    this._refreshHotbarDOM();
    this._refreshRecipeBookRows();
    if (this.onInventoryChange) this.onInventoryChange();
  }

  _setMineBar(p) {
    const bar = document.getElementById('mine-bar');
    const fill = document.getElementById('mine-fill');
    if (!bar || !fill) return;
    if (p <= 0 || !this._mining) {
      bar.classList.add('hidden');
      fill.style.width = '0%';
      return;
    }
    bar.classList.remove('hidden');
    fill.style.width = `${Math.min(100, p * 100)}%`;
  }

  _cancelMining() {
    this._mining = null;
    this._setMineBar(0);
  }

  _finishMining(m, handId) {
    const { x, y, z, id } = m;
    this._cancelMining();
    if (id === BLOCK.BEDROCK) return;
    if (BLOCK_INFO[id]?.fluid) return;
    this.world.setBlock(x, y, z, BLOCK.AIR);
    this.audio?.playBreak(id);
    this.onBreak?.(x, y, z, id);
    this.onEdit?.(x, y, z, BLOCK.AIR);
    this._propagateFluids(x, y, z);
    this.onChange?.();
    if (this.mode === 'survival' && canHarvestBlock(id, handId)) {
      const drop = dropIdForBlock(id);
      if (drop && !NO_DROP.has(drop)) this.addBlock(drop, 1);
    }
  }

  _buildInvSlotEl(globalIdx) {
    const el = document.createElement('div');
    el.className = 'inv-slot';
    el.dataset.idx = globalIdx;
    const icon = document.createElement('div');
    icon.className = 'inv-icon';
    const count = document.createElement('div');
    count.className = 'inv-count';
    el.appendChild(icon);
    el.appendChild(count);
    if (globalIdx < HOTBAR_SIZE) el.classList.add('hotbar-slot');
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this._onInvSlotMouseDown(globalIdx, e);
    });
    return el;
  }

  _refreshInventoryDOM() {
    if (!this._invOverlayEl) return;
    const els = this._invOverlayEl.querySelectorAll('.inv-slot[data-idx]');
    els.forEach(el => {
      const i = +el.dataset.idx;
      const s = this.slots[i];
      const icon = el.querySelector('.inv-icon');
      const count = el.querySelector('.inv-count');
      if (s) {
        icon.style.backgroundImage = `url(${blockIconDataURL(s.id, this.atlasCanvas)})`;
        icon.style.backgroundSize = 'cover';
        el.title = BLOCK_INFO[s.id]?.name || '';
        if (isFinite(s.count) && s.count > 1) count.textContent = s.count;
        else if (!isFinite(s.count)) count.textContent = '∞';
        else count.textContent = '';
      } else {
        icon.style.backgroundImage = 'none';
        el.title = '';
        count.textContent = '';
      }
      el.classList.toggle('empty', !s);
    });
    // Carried preview.
    if (this.carried) {
      this._invCursorEl.style.backgroundImage = `url(${blockIconDataURL(this.carried.id, this.atlasCanvas)})`;
      this._invCursorEl.dataset.count = isFinite(this.carried.count)
        ? (this.carried.count > 1 ? this.carried.count : '')
        : '∞';
      this._invCursorEl.classList.add('visible');
    } else {
      this._invCursorEl.classList.remove('visible');
    }
    if (this.mode === 'survival' && this.invOpen && this.craftGrid) {
      this._refreshCraftingDOM();
      this._refreshRecipeBookRows();
    }
  }

  openInventory() {
    if (this.invOpen) return;
    this._cancelMining();
    this.invOpen = true;
    this._invOverlayEl.classList.remove('hidden');
    this._refreshInventoryDOM();
    this._buildCraftingList();
    this._buildRecipeBookTab();
    this._setInventoryTab(this.activeInvTab);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  closeInventory() {
    if (!this.invOpen) return;
    this._cancelMining();
    this.invOpen = false;
    if (this.mode === 'survival' && this.craftGrid) this._stowCraftGrid();
    this._invOverlayEl.classList.add('hidden');
    // If the cursor is still holding a stack, try to auto-stow it. In creative
    // mode an unplaced stack just disappears (it's free anyway).
    if (this.carried) {
      if (this.mode === 'creative') {
        this.carried = null;
      } else {
        const left = this._autoStow(this.carried);
        this.carried = left.count > 0 ? left : null;
      }
    }
    this._refreshInventoryDOM();
    this._refreshHotbarDOM();
    if (this.onInventoryChange) this.onInventoryChange();
  }

  _onMouseMove(e) {
    if (!this.invOpen || !this._invCursorEl) return;
    this._moveInvCursor(e.clientX, e.clientY);
  }

  // Click handling inside the inventory grid.
  _onInvSlotMouseDown(i, e) {
    this._moveInvCursor(e.clientX, e.clientY);
    const s = this.slots[i];
    const carried = this.carried;
    const isLeft = e.button === 0;
    const isRight = e.button === 2;
    const shift = e.shiftKey;

    if (shift && s) {
      // Auto-shuttle between hotbar and main inventory.
      this._shiftClickTransfer(i);
      this._refreshInventoryDOM();
      this._refreshHotbarDOM();
      if (this.onInventoryChange) this.onInventoryChange();
      return;
    }

    if (isLeft) {
      if (!carried) {
        // Pick up the entire stack.
        if (s) {
          // Creative infinite stacks become finite on extraction so the player
          // can place them back without confusion.
          this.carried = isFinite(s.count) ? { id: s.id, count: s.count } : { id: s.id, count: 64 };
          this.slots[i] = null;
        }
      } else {
        if (!s) {
          this.slots[i] = carried;
          this.carried = null;
        } else if (s.id === carried.id && isFinite(s.count) && isFinite(carried.count)) {
          // Stack into existing.
          const room = STACK_MAX - s.count;
          const add = Math.min(room, carried.count);
          s.count += add;
          carried.count -= add;
          if (carried.count <= 0) this.carried = null;
        } else {
          // Swap.
          this.slots[i] = carried;
          this.carried = s;
        }
      }
    } else if (isRight) {
      if (carried) {
        // Place 1 unit.
        if (!s) {
          this.slots[i] = { id: carried.id, count: 1 };
          if (isFinite(carried.count)) carried.count -= 1;
          if (isFinite(carried.count) && carried.count <= 0) this.carried = null;
        } else if (s.id === carried.id && isFinite(s.count) && s.count < STACK_MAX) {
          s.count += 1;
          if (isFinite(carried.count)) carried.count -= 1;
          if (isFinite(carried.count) && carried.count <= 0) this.carried = null;
        }
      } else if (s && isFinite(s.count) && s.count > 1) {
        // Take half.
        const half = Math.ceil(s.count / 2);
        this.carried = { id: s.id, count: half };
        s.count -= half;
        if (s.count <= 0) this.slots[i] = null;
      } else if (s && isFinite(s.count) && s.count === 1) {
        this.carried = { id: s.id, count: 1 };
        this.slots[i] = null;
      } else if (s && !isFinite(s.count)) {
        // Creative infinite stack: take 64 in hand without depleting source.
        this.carried = { id: s.id, count: 64 };
      }
    }

    this._refreshInventoryDOM();
    this._refreshHotbarDOM();
    if (this.onInventoryChange) this.onInventoryChange();
  }

  // Move a stack between hotbar (0..8) and main (9..35) when shift-clicked.
  _shiftClickTransfer(i) {
    const from = this.slots[i];
    if (!from) return;
    const inHotbar = i < HOTBAR_SIZE;
    const range = inHotbar ? [HOTBAR_SIZE, INV_SIZE] : [0, HOTBAR_SIZE];
    let remaining = isFinite(from.count) ? from.count : 64;
    const finite = isFinite(from.count);
    // First fill matching stacks.
    for (let j = range[0]; j < range[1] && remaining > 0; j++) {
      const t = this.slots[j];
      if (t && t.id === from.id && isFinite(t.count) && t.count < STACK_MAX) {
        const room = STACK_MAX - t.count;
        const add = Math.min(room, remaining);
        t.count += add;
        remaining -= add;
      }
    }
    // Then put in first empty slot.
    for (let j = range[0]; j < range[1] && remaining > 0; j++) {
      if (!this.slots[j]) {
        const add = Math.min(STACK_MAX, remaining);
        this.slots[j] = { id: from.id, count: add };
        remaining -= add;
      }
    }
    if (finite) {
      from.count = remaining;
      if (from.count <= 0) this.slots[i] = null;
    }
    // Infinite (creative) stays untouched.
  }

  // Try to merge a stack back into the inventory; returns the leftover stack
  // (count > 0 means it didn't fully fit).
  _autoStow(stack) {
    if (!stack || !isFinite(stack.count)) return { id: stack?.id, count: 0 };
    let remaining = stack.count;
    for (let i = 0; i < INV_SIZE && remaining > 0; i++) {
      const t = this.slots[i];
      if (t && t.id === stack.id && isFinite(t.count) && t.count < STACK_MAX) {
        const room = STACK_MAX - t.count;
        const add = Math.min(room, remaining);
        t.count += add;
        remaining -= add;
      }
    }
    for (let i = 0; i < INV_SIZE && remaining > 0; i++) {
      if (!this.slots[i]) {
        const add = Math.min(STACK_MAX, remaining);
        this.slots[i] = { id: stack.id, count: add };
        remaining -= add;
      }
    }
    return { id: stack.id, count: remaining };
  }

  // ---------------------------------------------------------------------------
  // Highlight + selection
  // ---------------------------------------------------------------------------
  _buildHighlight() {
    const geo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    const edges = new THREE.EdgesGeometry(geo);
    const mat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.9 });
    this.highlight = new THREE.LineSegments(edges, mat);
    this.highlight.visible = false;
    this.scene.add(this.highlight);
  }

  select(i) {
    const next = ((i % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    if (next === this.selectedIndex) return;
    this.selectedIndex = next;
    this._refreshHotbarDOM();
    if (this.onSlot) this.onSlot(this.selectedIndex);
  }

  selectedBlock() {
    const s = this.slots[this.selectedIndex];
    if (!s || s.count <= 0) return null;
    if (!isPlaceable(s.id)) return null;
    return s.id;
  }

  /** Mise à jour du minage en survie (appelée depuis la boucle de jeu). */
  updateMining(dt) {
    if (this.mode !== 'survival') return;
    if (!this._mining) return;
    if (this.invOpen || this.player.dead || !this.player.locked) {
      this._cancelMining();
      return;
    }
    const m = this._mining;
    const hit = this._raycast();
    const handId = this.slots[this.selectedIndex]?.id;
    if (!hit || hit.block.x !== m.x || hit.block.y !== m.y || hit.block.z !== m.z || hit.block.id !== m.id) {
      this._cancelMining();
      return;
    }
    const dur = breakTimeSeconds(m.id, handId);
    if (!isFinite(dur) || dur <= 0) {
      this._cancelMining();
      return;
    }
    m.progress += dt / dur;
    this._setMineBar(m.progress);
    if (m.progress >= 1) this._finishMining(m, handId);
  }

  // ---------------------------------------------------------------------------
  // Add / consume blocks (used by mining, picking up dropped items, etc.)
  // ---------------------------------------------------------------------------
  addBlock(id, qty = 1) {
    if (NO_DROP.has(id) || qty <= 0) return false;
    let remaining = qty;
    // Try existing matching stacks (hotbar first, then main).
    for (let i = 0; i < INV_SIZE && remaining > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && isFinite(s.count) && s.count < STACK_MAX) {
        const room = STACK_MAX - s.count;
        const add = Math.min(room, remaining);
        s.count += add;
        remaining -= add;
      }
    }
    // Then any empty slot (hotbar first, then main).
    for (let i = 0; i < INV_SIZE && remaining > 0; i++) {
      if (!this.slots[i]) {
        const add = Math.min(STACK_MAX, remaining);
        this.slots[i] = { id, count: add };
        remaining -= add;
      }
    }
    this._refreshHotbarDOM();
    this._refreshInventoryDOM();
    if (this.onInventoryChange) this.onInventoryChange();
    return remaining === 0;
  }

  _consumeSelected() {
    const s = this.slots[this.selectedIndex];
    if (!s || s.count <= 0) return false;
    if (!isFinite(s.count)) return true;
    s.count -= 1;
    if (s.count <= 0) this.slots[this.selectedIndex] = null;
    this._refreshHotbarDOM();
    this._refreshInventoryDOM();
    if (this.onInventoryChange) this.onInventoryChange();
    return true;
  }

  // Drop the selected hotbar item: removes 1 unit and forwards spawn info to
  // the network handler. Returns the dropped block id (or null).
  dropSelected() {
    const s = this.slots[this.selectedIndex];
    if (!s || s.count <= 0) return null;
    const id = s.id;
    if (isFinite(s.count)) {
      s.count -= 1;
      if (s.count <= 0) this.slots[this.selectedIndex] = null;
    }
    this._refreshHotbarDOM();
    this._refreshInventoryDOM();
    if (this.onInventoryChange) this.onInventoryChange();
    return id;
  }

  setMode(mode, inventory) {
    this._cancelMining();
    if (this.mode === 'survival' && this.craftGrid) this._stowCraftGrid();
    this.mode = mode === 'survival' ? 'survival' : 'creative';
    this.slots = this._buildInitialSlots(inventory);
    this.craftGrid = this.mode === 'survival' ? new Array(CRAFT_SLOT_COUNT).fill(null) : null;
    this._refreshHotbarDOM();
    // Rebuild the inventory DOM in case the palette visibility changed.
    if (this._invOverlayEl) {
      this._invOverlayEl.remove();
      this._invOverlayEl = null;
      this._buildInventoryDOM();
    }
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  _onWheel(e) {
    if (this.invOpen) return;
    const dir = Math.sign(e.deltaY);
    this.select(this.selectedIndex + dir);
  }

  _onKeyDown(e) {
    // E toggles the inventory overlay (unless typing in chat etc.).
    if (e.code === 'KeyE' && !e.repeat) {
      // Don't intercept when an input is focused (chat).
      if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      e.preventDefault();
      if (this.invOpen) this.closeInventory();
      else this.openInventory();
      return;
    }
    if (this.invOpen && e.code === 'Escape') {
      e.preventDefault();
      this.closeInventory();
      return;
    }
    if (this.invOpen) return; // most other keys disabled while inventory open
    if (e.code.startsWith('Digit')) {
      const n = parseInt(e.code.slice(5), 10);
      if (n >= 1 && n <= HOTBAR_SIZE) this.select(n - 1);
    }
    if (e.code === 'KeyG' && !e.repeat) {
      // Drop the currently selected hotbar item.
      if (!this.player.locked || this.player.dead) return;
      const id = this.dropSelected();
      if (id != null && this.onDropItem) {
        // Spawn position 0.4m in front of the camera, with a little upward arc.
        const fwd = new THREE.Vector3();
        this.camera.getWorldDirection(fwd);
        const pos = this.camera.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, 0.6);
        const vel = fwd.clone().multiplyScalar(5);
        vel.y += 2.5;
        this.onDropItem({ x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vy: vel.y, vz: vel.z, blockId: id });
      }
    }
  }

  _onMouseUp() {
    if (this.mode === 'survival' && this._mining && this._mining.progress < 1) {
      this._cancelMining();
    }
  }

  _onMouseDown(e) {
    if (this.invOpen) return; // click handling is per-slot inside the overlay
    if (!this.player.locked) return;
    if (this.player.dead) return;
    const hit = this._raycast();
    if (!hit) return;

    if (e.button === 0) {
      const { x, y, z, id } = hit.block;
      if (id === BLOCK.BEDROCK || BLOCK_INFO[id]?.unbreakable) return;
      if (BLOCK_INFO[id]?.fluid) return;
      if (this.mode === 'creative') {
        this.world.setBlock(x, y, z, BLOCK.AIR);
        this.audio?.playBreak(id);
        this.onBreak?.(x, y, z, id);
        this.onEdit?.(x, y, z, BLOCK.AIR);
        this._propagateFluids(x, y, z);
        this.onChange?.();
        return;
      }
      // Survie : minage progressif (maintenir le clic gauche).
      const handId = this.slots[this.selectedIndex]?.id;
      const dur = breakTimeSeconds(id, handId);
      if (!isFinite(dur)) return;
      this._mining = { x, y, z, id, progress: 0 };
      this._setMineBar(0.01);
    } else if (e.button === 2) {
      const id = this.selectedBlock();
      if (id == null) return;
      const nx = hit.block.x + hit.normal.x;
      const ny = hit.block.y + hit.normal.y;
      const nz = hit.block.z + hit.normal.z;
      if (this._blockIntersectsPlayer(nx, ny, nz)) return;
      if (isFluidSource(this.world.getBlock(nx, ny, nz))) return;
      if (!this._consumeSelected()) return;
      this.world.setBlock(nx, ny, nz, id);
      this.audio?.playPlace(id);
      this.onEdit?.(nx, ny, nz, id);
      this._propagateFluids(nx, ny, nz);
      this.onChange?.();
    }
  }

  _moveInvCursor(x, y) {
    if (!this._invCursorEl || !this.invOpen) return;
    this._invCursorEl.style.left = `${x}px`;
    this._invCursorEl.style.top = `${y}px`;
  }

  _propagateFluids(x, y, z) {
    this.world.recomputeFluidsAround(x, y, z, {
      radius: 6,
      onChange: (cx, cy, cz, nid) => this.onEdit?.(cx, cy, cz, nid),
    });
  }

  _blockIntersectsPlayer(bx, by, bz) {
    const p = this.player.position;
    const halfW = 0.3, height = 1.8;
    const minX = p.x - halfW, maxX = p.x + halfW;
    const minY = p.y - height / 2, maxY = p.y + height / 2;
    const minZ = p.z - halfW, maxZ = p.z + halfW;
    return (bx + 1 > minX && bx < maxX &&
            by + 1 > minY && by < maxY &&
            bz + 1 > minZ && bz < maxZ);
  }

  _raycast() {
    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    this.camera.getWorldDirection(dir);

    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);

    const stepX = dir.x > 0 ? 1 : -1;
    const stepY = dir.y > 0 ? 1 : -1;
    const stepZ = dir.z > 0 ? 1 : -1;

    const tDeltaX = Math.abs(1 / dir.x);
    const tDeltaY = Math.abs(1 / dir.y);
    const tDeltaZ = Math.abs(1 / dir.z);

    const frac = (v, s) => {
      const f = v - Math.floor(v);
      return s > 0 ? (1 - f) : f;
    };
    let tMaxX = tDeltaX * frac(origin.x, stepX);
    let tMaxY = tDeltaY * frac(origin.y, stepY);
    let tMaxZ = tDeltaZ * frac(origin.z, stepZ);

    let nx = 0, ny = 0, nz = 0;
    let traveled = 0;

    while (traveled < REACH) {
      const id = this.world.getBlock(x, y, z);
      if (isSolid(id)) {
        return {
          block: { x, y, z, id },
          normal: { x: nx, y: ny, z: nz },
        };
      }
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          x += stepX; traveled = tMaxX; tMaxX += tDeltaX;
          nx = -stepX; ny = 0; nz = 0;
        } else {
          z += stepZ; traveled = tMaxZ; tMaxZ += tDeltaZ;
          nx = 0; ny = 0; nz = -stepZ;
        }
      } else {
        if (tMaxY < tMaxZ) {
          y += stepY; traveled = tMaxY; tMaxY += tDeltaY;
          nx = 0; ny = -stepY; nz = 0;
        } else {
          z += stepZ; traveled = tMaxZ; tMaxZ += tDeltaZ;
          nx = 0; ny = 0; nz = -stepZ;
        }
      }
    }
    return null;
  }

  updateHighlight() {
    if (!this.player.locked || this.player.dead) {
      this.highlight.visible = false;
      return;
    }
    const hit = this._raycast();
    if (hit) {
      this.highlight.visible = true;
      this.highlight.position.set(hit.block.x + 0.5, hit.block.y + 0.5, hit.block.z + 0.5);
    } else {
      this.highlight.visible = false;
    }
  }
}
