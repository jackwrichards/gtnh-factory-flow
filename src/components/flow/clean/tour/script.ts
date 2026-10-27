"use client";

import { isLiveConfigured } from "@/lib/live/live-config";
import { useFactoryStore } from "@/store/factory-store";
import { setMinimap } from "../minimap/minimap-settings";
import { A, type Action, type Step } from "./director";
import { pressKey } from "./input";
import { tourDesignId, tourTaskBoardIds } from "./sandbox";
import {
  addRecipe,
  barKey,
  around,
  beside,
  leftOf,
  underCard,
  boardSpot,
  cardPart,
  clearBeside,
  drawerOf,
  drawerPart,
  feedbackKey,
  fitKey,
  forcedRow,
  libraryKey,
  itemTile,
  itemsSearch,
  machineTab,
  machineTabOpen,
  menuRow,
  nodeCount,
  overlayKey,
  pointIn,
  settingsSheet,
  portBox,
  portHandle,
  powerKey,
  powerUnitKey,
  rateUnitKey,
  railLine,
  railRoot,
  railSection,
  recipeOverlay,
  recipePageSettled,
  redoKey,
  solved,
  spareBar,
  spareBlock,
  storageCount,
  topKey,
  undoKey,
} from "./script-targets";
import { card, css, keepDetail, portRow, textOf, within, type Target } from "./targets";

/**
 * The tour, step by step (the mod's Script, on the website's planner): each step acts something out on the real UI,
 * then a note beside what it did says what it is. Words between asterisks are gold. Steps that need the game
 * (NEI, placing in the world, the pin list) are left out; the minimap and the feedback box are in.
 * Write notes short and plain, one sentence a thought, no commas where a full stop will do.
 */

const store = () => useFactoryStore.getState();

/** The machine count the solver gave the nth card. */
function machines(index: number): number {
  const id = store().project.nodes[index]?.id;
  return id ? (store().lastResult.nodes[id]?.theoreticalMachinesRequired ?? 0) : 0;
}

function pinnedCount(index: number): number | undefined {
  return store().project.nodes[index]?.solvePin;
}

function setNode(index: number, patch: Record<string, unknown>) {
  const id = store().project.nodes[index]?.id;
  if (id) store().updateNode(id, patch);
}

/** Sets a card's count rule to Exactly: an Up to count makes no forced flow, and these steps show forced flows. */
function pinExactly(index: number) {
  setNode(index, { solvePinExact: true });
}

/** Clears a card's port pins and count pin through the store: the way a step puts the plan back to a known state. */
function unpin(index: number) {
  setNode(index, { portRates: undefined, solvePin: undefined, solvePinExact: undefined });
}

// Fit, then back in to where the cards show their parts: a narrow board fits a plan down to the glance view.
const fit = A.seq(A.click(fitKey, { label: "Fit key" }), A.wait(350), A.run(keepDetail));
const closeMenus = A.run(() => {
  pressKey("Escape");
});

const BENDER = /Bending Machine/;

// The forced-flow chain: sulfuric acid from a Large Chemical Reactor, its oxygen from an Electrolyzer (water in,
// oxygen and hydrogen cells out), its acid used by a Mixer (sugar and acid in, diluted acid and charcoal out).
// Recipes are told apart by the text of their rows (amount, then name), run together.
const ELECTROLYZER = /^Electrolyzer/;
const ACID_RECIPE = /×1Sulfur Dust3,000Oxygen1,000Water/;
const WATER_TO_OXYGEN = /1,000Water.*×2Hydrogen Cell1,000Oxygen/;
const SUGAR_MIXER = /×4Sugar1,000Sulfuric Acid/;
const MIXER = /^Mixer$/;

/** Whether the drawer for a resource is a trash drawer (or, with "Product", a product drawer): read off its rule key. */
function drawerIs(name: string, kind: "Trash" | "Product"): boolean {
  const key = drawerPart(name, "rule")();
  if (!key) return false;
  const trash = key.getAttribute("aria-label") === "Rule: Trash";
  return kind === "Trash" ? trash : !trash;
}

/** Electrolyzers to pin: twice what the reactor needs for the mixer's acid, so they make too much oxygen. */
function electrolyzersForExcess(): number {
  const nodes = store().project.nodes;
  const flows = (index: number, side: "inputs" | "outputs") => {
    const id = nodes[index]?.id;
    return id ? (store().lastResult.nodes[id]?.[side]?.["fluid:oxygen"]?.amountPerSecond ?? 0) : 0;
  };
  const each = flows(1, "outputs") / Math.max(1, machines(1));
  const needed = flows(0, "inputs");
  return each > 0 ? Math.max(6, 2 * Math.ceil(needed / each - 1e-6)) : 10;
}

// region From the items list to a card

/** Opens a machine's tab in the recipe search, turning the strip of tabs to it first. */
const openMachineTab = (machine: RegExp, label: string): Action[] => [
  A.until(
    () => machineTab(machine)() !== null || overlayKey("Next machines")() !== null,
    `${label}'s tab`,
    20000,
  ),
  ...Array.from({ length: 6 }, () =>
    A.when(
      () => machineTab(machine)() === null && overlayKey("Next machines")() !== null,
      A.click(overlayKey("Next machines"), { label: "more machines" }),
    ),
  ),
  A.when(() => !machineTabOpen(machine), A.click(machineTab(machine), { label: `${label}'s tab` })),
  A.until(() => machineTabOpen(machine), `${label}'s recipes`),
];

/** Turns the open tab's pages until the recipe is on one. */
const pageToRecipe = (machine: RegExp, has: RegExp | undefined, label: string): Action[] => [
  A.until(() => addRecipe(machine, has)() !== null || recipePageSettled(), label, 20000),
  ...Array.from({ length: 12 }, () =>
    A.when(
      () => addRecipe(machine, has)() === null && overlayKey("Next page")() !== null,
      A.seq(
        A.click(overlayKey("Next page"), { label: "next page" }),
        A.until(recipePageSettled, label, 20000),
      ),
    ),
  ),
  A.until(() => addRecipe(machine, has)() !== null, label, 20000),
];

/** Search for the plates and open their recipes, down to the bender's add key. */
const openPlateRecipes: Action[] = [
  A.run(() => {
    store().clearResourceBrowser();
    store().setRecipeSearch("");
  }),
  A.type(itemsSearch, "iron plate", { label: "items search" }),
  A.until(() => itemTile("Iron Plate")() !== null, "Iron Plate in the list"),
  A.click(itemTile("Iron Plate"), { label: "Iron Plate" }),
  A.until(() => recipeOverlay() !== null, "recipe search"),
  A.wait(300),
  ...openMachineTab(BENDER, "the bender"),
  ...pageToRecipe(BENDER, undefined, "the bender's recipe"),
  A.show(addRecipe(BENDER)),
  A.wait(250),
];

const findRecipe: Step = {
  id: "find-recipe",
  actions: openPlateRecipes,
  note: { text: "This key *adds a recipe to a plan*.", at: addRecipe(BENDER) },
};

const firstCard: Step = {
  id: "card",
  actions: [
    // Back to this step starts with the search shut; open it again.
    A.when(() => addRecipe(BENDER)() === null, A.seq(...openPlateRecipes)),
    A.click(addRecipe(BENDER), { label: "add the bender's recipe" }),
    A.until(() => nodeCount() === 1, "the card"),
    A.until(solved, "the solve"),
    A.wait(200),
    fit,
    A.wait(400),
  ],
  note: {
    text: "This is a *recipe in a plan*. It does nothing yet: nothing has told it how much to make.",
    at: card(0),
    bare: true,
  },
};

// endregion

// region Getting around

const mouseAround: Step = {
  id: "mouse",
  actions: [
    fit,
    A.wait(300),
    A.drag(boardSpot(0.25, 0.72), boardSpot(0.33, 0.6), { label: "pan" }),
    A.wheel(boardSpot(0.5, 0.5), -240, { times: 2, label: "zoom in" }),
    A.wheel(boardSpot(0.5, 0.5), 240, { times: 2, label: "zoom out" }),
    fit,
  ],
  note: {
    text: "{M} *Middle mouse* to pan.\n{W} *Scroll* to zoom.\n{L} *Left click* to pan, or drag things around.",
    nothing: true,
  },
};

const keysAround: Step = {
  id: "keys",
  actions: [
    fit,
    A.wait(300),
    A.key("d", { hold: 450, caps: ["D"] }),
    A.key("a", { hold: 450, caps: ["A"] }),
    A.key("PageUp", { hold: 350, caps: ["Page Up"] }),
    A.key("PageDown", { hold: 350, caps: ["Page Down"] }),
    fit,
  ],
  note: {
    text: "{K} *W A S D* or the *arrow keys* to pan.\n{K} *Page Up* and *Page Down*, or *+* and *-*, to zoom.",
    nothing: true,
  },
};

// endregion

// region Numbers to solve for

const pinNumber: Step = {
  id: "number",
  actions: [
    fit,
    A.type(portBox(0, "Output", "Iron Plate"), "10", {
      enter: true,
      label: "the plates' rate box",
    }),
    A.until(() => machines(0) > 0, "the card's count"),
    A.until(solved, "the solve"),
    A.wait(300),
  ],
  note: { text: "You can *pin a number* and it calculates the other numbers.", at: card(0) },
};

const pinCount: Step = {
  id: "count",
  actions: [
    A.run(() => unpin(0)),
    A.wait(300),
    A.type(cardPart(0, "count"), "2", { enter: true, label: "the count" }),
    A.until(() => pinnedCount(0) === 2, "the pinned count"),
    A.until(solved, "the solve"),
    A.wait(300),
  ],
  note: { text: "Or pin the *machine count*.", at: cardPart(0, "count") },
};

const pinInput: Step = {
  id: "input",
  actions: [
    A.run(() => unpin(0)),
    A.wait(300),
    A.type(portBox(0, "Input", "Iron Ingot"), "5", { enter: true, label: "the ingots' rate box" }),
    A.until(() => machines(0) > 0, "the card's count"),
    A.until(solved, "the solve"),
    A.wait(300),
  ],
  note: {
    text: "Or pin an *input*.",
    at: around(portRow(0, "Input", "Iron Ingot"), portBox(0, "Input", "Iron Ingot")),
  },
};

// endregion

// region The machine

const tierStep: Step = {
  id: "tier",
  actions: [
    A.run(() => unpin(0)),
    A.wait(200),
    A.click(cardPart(0, "tier"), { label: "tier chip" }),
    A.wait(300),
    A.click(cardPart(0, "tier"), { button: 2, label: "tier chip" }),
    A.until(solved, "the solve"),
    A.wait(300),
  ],
  note: { text: "Set the machine's *tier* here.", at: cardPart(0, "tier") },
};

const powerStep: Step = {
  id: "power",
  actions: [A.wait(250)],
  note: {
    text: "Power use is shown here, but machines *don't need to be wired to power*. The circuit is also shown.",
    at: around(cardPart(0, "power"), cardPart(0, "picture")),
  },
};

const settingsStep: Step = {
  id: "settings",
  actions: [A.click(cardPart(0, "gear"), { label: "settings key" }), A.wait(500)],
  note: {
    text: "This is the *settings panel*. If it has any settings, you can *pin* them to show them on the card.",
    at: () => settingsSheet() ?? cardPart(0, "gear")(),
  },
};

// endregion

// region Drawers

const cloneStep: Step = {
  id: "clone",
  actions: [
    closeMenus,
    A.run(() => unpin(0)),
    A.click(cardPart(0, "menu"), { label: "card menu" }),
    A.click(menuRow(/Clone/i), { label: "Clone" }),
    A.until(() => nodeCount() === 2, "the clone"),
    A.wait(300),
    // The clone lands beside its card; a hand moves it under.
    A.drag(cardPart(1, "head"), underCard(card(0), card(1), cardPart(1, "head")), {
      label: "move the clone",
    }),
    A.wait(300),
    fit,
    A.wait(500),
  ],
  note: { text: "You can *clone* machines.", at: card(1) },
};

const drawerFromPort: Step = {
  id: "drawer-port",
  actions: [
    A.drag(portHandle(0, "Output", "Iron Plate"), clearBeside(card(0), 90), {
      label: "the plates",
    }),
    A.until(() => storageCount() >= 1, "the drawer"),
    A.wait(300),
  ],
  note: {
    text: "Drag an *input* or an *output* to make it a *drawer*.",
    at: drawerOf("Iron Plate"),
  },
};

const drawerFromItems: Step = {
  id: "drawer-items",
  actions: [
    A.type(itemsSearch, "iron ingot", { label: "items search" }),
    A.until(() => itemTile("Iron Ingot")() !== null, "Iron Ingot in the list"),
    A.dragItem(itemTile("Iron Ingot"), leftOf(card(0), 130), { label: "Iron Ingot" }),
    A.until(() => drawerOf("Iron Ingot")() !== null, "the ingots' drawer"),
    A.wait(300),
  ],
  note: { text: "Or bring one in from the *items list*.", at: drawerOf("Iron Ingot") },
};

const wiring: Step = {
  id: "wiring",
  actions: [
    A.drag(portHandle(1, "Output", "Iron Plate"), drawerPart("Iron Plate", "body"), {
      label: "second plates wire",
    }),
    A.wait(300),
    A.drag(drawerPart("Iron Ingot", "body"), portHandle(0, "Input", "Iron Ingot"), {
      label: "ingot wire",
    }),
    A.wait(300),
    A.drag(drawerPart("Iron Ingot", "body"), portHandle(1, "Input", "Iron Ingot"), {
      label: "second ingot wire",
    }),
    A.wait(300),
    A.type(drawerPart("Iron Plate", "rate"), "20", {
      enter: true,
      label: "the plates drawer's rate",
    }),
    A.until(solved, "the solve"),
    A.type(cardPart(0, "count"), "7", { enter: true, label: "the first count" }),
    A.until(() => pinnedCount(0) === 7, "the pinned count"),
    A.until(solved, "the solve"),
    A.wait(300),
  ],
  note: {
    text: "*Drag from a drawer* to wire it. Set the drawer's *rate* and it applies to every machine wired to it.",
    at: drawerPart("Iron Plate", "rate"),
  },
};

const arrange: Step = {
  id: "arrange",
  actions: [
    A.when(
      () => topKey(/^Arrange/)() === null,
      A.click(topKey(/^View options/), { label: "View options" }),
    ),
    A.click(topKey(/^Arrange/), { label: "Arrange" }),
    A.wait(1500),
    fit,
    A.wait(400),
  ],
  note: {
    text: "*Arrange* untangles the plan, and *Fit* brings all of it into view.",
    at: topKey(/^Arrange|^View options/),
  },
};

// endregion

// region The overview

const overview: Step = {
  id: "overview",
  actions: [A.wait(200)],
  note: {
    text: "The *overview* lists everything in the plan. You can set your inputs and outputs from here too.",
    at: railRoot,
  },
};

const colours: Step = {
  id: "colours",
  actions: [A.wait(200)],
  note: {
    text: "{b:Blue} is always something coming into your plan, and {o:Orange} is always something leaving it. Nothing else is shown in those colours.",
    at: around(
      railSection(/INPUTS/),
      railLine(/Iron Ingot/),
      railSection(/OUTPUTS/),
      railLine(/Iron Plate/),
    ),
  },
};

const machinesStep: Step = {
  id: "machines",
  actions: [A.wait(200)],
  note: {
    text: "Your *machines* are here too: set how many from here, as on their cards.",
    at: railSection(/MACHINES/),
  },
};

// endregion

// region One machine for two recipes, undo, and how numbers show

const combine: Step = {
  id: "combine",
  actions: [
    A.click(cardPart(0, "picture"), { label: "first card" }),
    A.wait(150),
    A.withKey(
      "Shift",
      [A.click(cardPart(1, "picture"), { mods: { shift: true }, label: "second card" })],
      { caps: ["Shift"] },
    ),
    A.until(
      () => textOf("button, [role=button]", /^Combine\s*2/i)() !== null,
      "the Combine key",
      2500,
    ),
    A.click(textOf("button, [role=button]", /^Combine\s*2/i), { label: "Combine" }),
    A.until(() => nodeCount() === 1, "the combined card", 3000),
    A.wait(300),
  ],
  note: {
    text: "Hold *Shift* to select more than one. Then you can *merge* machines, to run two recipes on one machine.",
    at: card(0),
  },
};

const undo: Step = {
  id: "undo",
  actions: [
    A.when(() => nodeCount() === 1, A.click(undoKey, { label: "Undo" })),
    A.until(() => nodeCount() === 2, "the undone merge", 3000),
    A.wait(300),
  ],
  note: { text: "*Undo* and *redo* are up here.", at: around(undoKey, redoKey) },
};

const units: Step = {
  id: "units",
  actions: [
    A.click(rateUnitKey, { label: "rate key" }),
    A.wait(150),
    A.click(rateUnitKey, { label: "rate key" }),
    A.wait(150),
    A.click(rateUnitKey, { label: "rate key" }),
    A.wait(150),
    A.click(rateUnitKey, { label: "rate key" }),
    A.wait(150),
    A.click(powerUnitKey, { label: "power key" }),
    A.wait(250),
    A.click(powerUnitKey, { label: "power key" }),
  ],
  note: {
    text: "These buttons change *the way numbers are shown*.",
    at: around(rateUnitKey, powerUnitKey),
  },
};

// endregion

// region Forced inputs and outputs

const LARGE_REACTOR = /^Large Chemical Reactor/;

/** The recipe search's add key for a port's what-makes-it (left click) or what-uses-it (right click) page. */
const searchFromPort = (port: Target, button: 0 | 2, label: string): Action[] => [
  A.click(within(port, ".cc-icon"), { button, label }),
  A.until(() => recipeOverlay() !== null, `${label}: recipe search`, 20000),
  A.wait(300),
];

const forcedAdd: Step = {
  id: "forced-add",
  actions: [
    A.run(() => store().cleanBoard()),
    A.until(() => nodeCount() === 0, "the clean board"),
    A.run(() => {
      store().clearResourceBrowser();
      store().setRecipeSearch("");
    }),
    A.type(itemsSearch, "sulfuric acid", { label: "items search" }),
    A.until(() => itemTile("Sulfuric Acid")() !== null, "Sulfuric Acid in the list"),
    // The list is still filling as the first tiles show: let it settle, and click again if the click hit a tile
    // that moved.
    A.wait(500),
    A.click(itemTile("Sulfuric Acid"), { label: "Sulfuric Acid" }),
    A.wait(1200),
    A.when(
      () => recipeOverlay() === null,
      A.click(itemTile("Sulfuric Acid"), { label: "Sulfuric Acid" }),
    ),
    A.until(() => recipeOverlay() !== null, "recipe search"),
    ...openMachineTab(LARGE_REACTOR, "the large reactor"),
    ...pageToRecipe(LARGE_REACTOR, ACID_RECIPE, "the reactor's recipe"),
    A.show(addRecipe(LARGE_REACTOR, ACID_RECIPE)),
    A.click(addRecipe(LARGE_REACTOR, ACID_RECIPE), { label: "add the reactor's recipe" }),
    A.until(() => nodeCount() === 1, "the card"),
    A.until(solved, "the solve"),
    fit,
    A.type(portBox(0, "Output", "Sulfuric Acid"), "20", {
      enter: true,
      label: "the acid's rate box",
    }),
    A.until(() => machines(0) > 0, "the reactor's count"),
    A.until(solved, "the solve"),
    A.wait(300),
  ],
  note: { text: "Add as many recipes to a plan as you like.", at: card(0) },
};

const forcedWired: Step = {
  id: "forced-wired",
  actions: [
    ...searchFromPort(portRow(0, "Input", "Oxygen"), 0, "the oxygen input"),
    ...openMachineTab(ELECTROLYZER, "the electrolyzer"),
    ...pageToRecipe(ELECTROLYZER, WATER_TO_OXYGEN, "the electrolyzer's recipe"),
    A.show(addRecipe(ELECTROLYZER, WATER_TO_OXYGEN)),
    A.click(addRecipe(ELECTROLYZER, WATER_TO_OXYGEN), { label: "add the electrolyzer's recipe" }),
    A.until(() => nodeCount() === 2, "the second card"),
    A.until(solved, "the solve"),
    fit,
    A.wait(400),
  ],
  note: {
    text: "Click an input to find *what makes it*. A recipe added from there comes in *already wired*.",
    at: card(1),
  },
};

const forcedInput: Step = {
  id: "forced-input",
  actions: [
    A.type(cardPart(1, "count"), "1", { enter: true, label: "the electrolyzer's count" }),
    A.until(() => pinnedCount(1) === 1, "the electrolyzer's pin"),
    A.run(() => pinExactly(1)),
    A.until(solved, "the solve"),
    A.until(() => forcedRow(0, "Input", "Oxygen")() !== null, "the reactor's Forced row"),
    A.wait(400),
  ],
  note: {
    text: "The acid is set and one electrolyzer is pinned *exactly*, but it can't keep up. The plan has to bring in the rest of the oxygen anyway: a *forced input*.",
    at: forcedRow(0, "Input", "Oxygen"),
  },
};

const forcedUses: Step = {
  id: "forced-uses",
  actions: [
    ...searchFromPort(portRow(0, "Output", "Sulfuric Acid"), 2, "the acid output"),
    ...openMachineTab(MIXER, "the mixer"),
    ...pageToRecipe(MIXER, SUGAR_MIXER, "the mixer's recipe"),
    A.show(addRecipe(MIXER, SUGAR_MIXER)),
    A.click(addRecipe(MIXER, SUGAR_MIXER), { label: "add the mixer's recipe" }),
    A.until(() => nodeCount() === 3, "the third card"),
    A.until(solved, "the solve"),
    fit,
    A.wait(400),
  ],
  note: { text: "*Right-click* an output to find *what uses it*.", at: card(2) },
};

const forcedOutput: Step = {
  id: "forced-output",
  actions: [
    A.type(cardPart(2, "count"), "1", { enter: true, label: "the mixer's count" }),
    A.until(() => pinnedCount(2) === 1, "the mixer's pin"),
    A.run(() => pinExactly(2)),
    // The acid's own rate goes (the mod drops a port's rate once it is wired): the reactor is free to make more than the mixer takes.
    A.run(() => setNode(0, { portRates: undefined })),
    A.until(solved, "the solve"),
    A.wait(600),
    (c) =>
      A.type(cardPart(1, "count"), String(electrolyzersForExcess()), {
        enter: true,
        label: "the electrolyzer's count",
      })(c),
    A.until(() => (pinnedCount(1) ?? 0) > 1, "the electrolyzer's pin"),
    A.run(() => pinExactly(1)),
    A.until(() => spareBlock("Oxygen")() !== null, "the spare oxygen block", 6000),
    A.until(solved, "the solve"),
    A.wait(400),
  ],
  note: {
    text: "Electrolyzer pinned *exactly* high, mixer pinned *exactly* low: more oxygen is made than used. The excess leaves the plan as a *forced output*.",
    at: spareBlock("Oxygen"),
  },
};

const forcedSplit: Step = {
  id: "forced-split",
  actions: [
    A.click(pointIn(spareBar("Oxygen", 0), 0.97, 0.5), { label: "the first end of the slider" }),
    A.until(solved, "the solve"),
    A.wait(1000),
    A.click(pointIn(spareBar("Oxygen", 1), 0.97, 0.5), { label: "the other end of the slider" }),
    A.until(solved, "the solve"),
    A.wait(1000),
    A.click(pointIn(spareBar("Oxygen", 0), 0.5, 0.5), { label: "the middle of the slider" }),
    A.until(solved, "the solve"),
    // Off the bar, so its tip is gone when the note shows.
    A.go(boardSpot(0.5, 0.12), "free board"),
    A.wait(400),
  ],
  note: {
    text: "The excess can leave at more than one machine. The *slider* sets the split: oxygen out of the electrolyzer, or extra acid out of the reactor. *Auto* hands it back to the solver.",
    at: spareBlock("Oxygen"),
  },
};

// endregion

// region Products, trash and power

const trashStep: Step = {
  id: "trash",
  actions: [
    A.drag(portHandle(2, "Output", "Charcoal"), clearBeside(card(2), 130), {
      label: "the charcoal",
    }),
    A.until(() => drawerOf("Charcoal")() !== null, "the charcoal drawer"),
    A.wait(300),
    // The new drawer can land against the card at the board's edge: Arrange gives it room.
    A.click(topKey(/^Arrange/), { label: "Arrange" }),
    A.wait(1500),
    fit,
    A.wait(400),
    A.click(drawerPart("Charcoal", "rule"), { label: "the drawer's rule key" }),
    A.click(menuRow(/^Void it/), { label: "Void it" }),
    A.until(() => drawerIs("Charcoal", "Trash"), "the trash drawer"),
    A.until(solved, "the solve"),
    A.wait(400),
  ],
  note: {
    text: "This key's menu also makes a product drawer *trash*: it voids what comes in, and leaves your outputs.",
    at: drawerPart("Charcoal", "rule"),
  },
};

const productStep: Step = {
  id: "product",
  actions: [
    A.when(
      () => !drawerIs("Charcoal", "Product"),
      A.seq(
        A.click(drawerPart("Charcoal", "rule"), { label: "the drawer's rule key" }),
        A.click(menuRow(/^Keep it/), { label: "Keep it" }),
      ),
    ),
    A.until(() => drawerIs("Charcoal", "Product"), "the product drawer"),
    A.until(solved, "the solve"),
    A.wait(400),
  ],
  note: {
    text: "And back to a *product*. On *Any* it takes whatever comes out; set a rate and the plan works toward it.",
    at: drawerPart("Charcoal", "body"),
  },
};

const nonRecipe: Step = {
  id: "non-recipe",
  actions: [closeMenus, A.click(powerKey, { label: "Power" }), A.wait(500)],
  note: {
    text: "This section is for *non-recipe machines*, mostly power generation.",
    at: powerKey,
  },
};

// endregion

// region In the minimap and the rest of the chrome

const minimapStep: Step = {
  id: "minimap",
  actions: [
    A.run(() => setMinimap({ show: true, size: "small", shape: "square", corner: "bottom-right" })),
    A.wait(300),
    A.drag(
      () => {
        const m = document.querySelector("[data-minimap]");
        if (!m) return null;
        const r = m.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      },
      () => {
        const m = document.querySelector("[data-minimap]");
        if (!m) return null;
        const r = m.getBoundingClientRect();
        return { x: r.left + r.width / 2 + 24, y: r.top + r.height / 2 + 12 };
      },
      { label: "the map" },
    ),
    A.wait(300),
    fit,
  ],
  note: {
    text: "The *minimap* shows your whole plan. Drag on it to move the board, and *N* hides it. Its gear sets its size and corner.",
    at: () => document.querySelector("[data-minimap]"),
  },
};

const stickyNote: Step = {
  id: "sticky-note",
  actions: [
    closeMenus,
    fit,
    A.right(boardSpot(0.16, 0.2), { label: "free board" }),
    A.click(textOf("button, [role=menuitem], [role=button], li", /^Add (a )?sticky note$/), {
      label: "Add sticky note",
    }),
    A.until(() => css(".sn")() !== null, "the note"),
    A.wait(300),
    A.type(css(".sn-area"), "Hydrogen comes from the electrolyzers by the door.", {
      keep: true,
      label: "the note's text",
    }),
    A.wait(300),
    A.click(boardSpot(0.5, 0.92), { label: "free board" }),
    A.wait(300),
  ],
  note: {
    text: "Annotations are possible with *sticky notes*. Right-click anywhere to make one.",
    at: css(".sn"),
  },
};

// region Your plans, plans together, task boards

const shareKey: Target = barKey("share");
const plansKey: Target = barKey("plans");
const tourPlanTab: Target = () => {
  const id = tourDesignId();
  return id ? css(`[data-design-id="${id}"]`)() : null;
};

const inviteStep: Step = {
  id: "invite",
  actions: [closeMenus, A.wait(300)],
  note: {
    text: "Sign in and your plans save as you edit, on any computer and in the game. *Share* invites someone to build the plan with you, live.",
    at: shareKey,
  },
};

const plansStep: Step = {
  id: "plans",
  actions: [closeMenus, A.click(plansKey, { label: "Plans" }), A.wait(1000)],
  note: { text: "*Plans* has all your plans, and the ones people shared with you.", at: plansKey },
};

const noticeOpen: Target = textOf("button", /^Open$/, css("[data-live-notice]"));

const taskBoardStep: Step = {
  id: "task-board",
  actions: [
    closeMenus,
    A.click(cardPart(0, "menu"), { label: "card menu" }),
    A.click(menuRow(/^Add to a task/), { label: "Add to a task" }),
    A.click(menuRow(/^New task board/), { label: "New task board" }),
    A.until(() => noticeOpen() !== null, "the notice"),
    A.wait(400),
  ],
  note: {
    text: "*Add to a task* puts machines on a task board, with how many to build.",
    at: css("[data-live-notice] p"),
  },
};

const taskStep: Step = {
  id: "task",
  actions: [
    A.when(() => noticeOpen() !== null, A.click(noticeOpen, { label: "Open" })),
    A.when(
      () => store().project.primaryView !== "tasks",
      A.click(
        () => {
          const id = tourTaskBoardIds()[0];
          return id ? css(`[data-design-id="${id}"]`)() : null;
        },
        { label: "the tour's task board" },
      ),
    ),
    A.when(
      () => css("[data-task-panel]")() === null,
      A.click(css("[data-task-card] .tb-card-title"), { label: "the machine task" }),
    ),
    A.until(() => css('[aria-label="Task title"]')() !== null, "the task box"),
    A.wait(600),
  ],
  note: {
    text: "A *task* holds notes, a checklist, comments and who is on it. Drag it across the columns as the work goes.",
    at: css('[aria-label^="Task: "]'),
  },
};

const planTaskStep: Step = {
  id: "plan-task",
  actions: [
    closeMenus,
    A.when(
      () => css('button[aria-label="Close the task"]')() !== null,
      A.click(css('button[aria-label="Close the task"]'), { label: "close the task" }),
    ),
    A.click(tourPlanTab, { label: "the tour's plan tab" }),
    A.until(() => store().project.primaryView !== "tasks" && solved(), "the source plan"),
    A.right(tourPlanTab, { label: "the plan tab" }),
    A.until(() => menuRow(/^Add plan as a task/)() !== null, "Add plan as a task"),
  ],
  note: {
    text: "Right-click a *plan tab* and choose *Add plan as a task* to put all its machines in one checklist.",
    at: menuRow(/^Add plan as a task/),
  },
};

const planTaskLinkStep: Step = {
  id: "plan-task-link",
  actions: [
    closeMenus,
    A.when(
      () => css('[data-live-notice] button[aria-label="Dismiss"]')() !== null,
      A.click(css('[data-live-notice] button[aria-label="Dismiss"]'), {
        label: "dismiss the earlier notice",
      }),
    ),
    A.right(tourPlanTab, { label: "the plan tab" }),
    A.click(menuRow(/^Add plan as a task/), { label: "Add plan as a task" }),
    A.click(menuRow(/^New task board/), { label: "New task board" }),
    A.until(() => noticeOpen() !== null, "the plan task notice", 12000),
    A.click(noticeOpen, { label: "Open" }),
    A.until(
      () => css("[data-task-panel] [data-task-plan-label]")() !== null,
      "the whole-plan task",
    ),
  ],
  note: {
    text: "The *Plan* link opens this task's source plan. Its checklist holds every machine to build.",
    at: css("[data-task-panel] .tb-plan-link"),
  },
};

const planTaskUpdateStep: Step = {
  id: "plan-task-update",
  actions: [
    closeMenus,
    A.when(
      () => css("[data-task-panel] .tb-plan-link")() === null,
      A.click(css("[data-task-card] .tb-card-title"), { label: "the whole-plan task" }),
    ),
    A.until(() => css("[data-task-panel] .tb-plan-link")() !== null, "the task's Plan link"),
    A.click(css("[data-task-panel] .tb-plan-link"), { label: "Plan" }),
    A.until(() => store().project.primaryView !== "tasks" && nodeCount() > 0, "the source plan"),
    A.run(() => unpin(0)),
    A.type(cardPart(0, "count"), "2", { enter: true, label: "the machine count" }),
    A.run(() => pinExactly(0)),
    A.until(() => solved() && machines(0) === 2, "the new machine counts"),
    A.right(tourPlanTab, { label: "the plan tab" }),
    A.until(() => menuRow(/^Update a task/)() !== null, "Update a task"),
    A.click(menuRow(/^Update a task/), { label: "Update a task" }),
    A.click(css('[role="menu"][aria-label="Update a task"] [role="menuitem"]'), {
      label: "the plan's task",
    }),
    A.until(() => noticeOpen() !== null, "the updated task notice", 12000),
    A.click(noticeOpen, { label: "Open" }),
    A.until(() => css("[data-task-panel] [data-task-plan-label]")() !== null, "the refreshed task"),
  ],
  note: {
    text: "After editing the plan, *Update a task* refreshes its machines. Same or smaller amounts keep checkmarks. More machines or a changed machine or tier clear them.",
    at: css("[data-task-things-head]"),
  },
};

// endregion

// The Community shelf, in the library Plans opens.
const libraryTab: Target = textOf(".ml-tab", /^COMMUNITY/);

const libraryStep: Step = {
  id: "library",
  actions: [
    A.when(() => libraryTab() === null, A.click(libraryKey, { label: "Plans" })),
    A.until(() => libraryTab() !== null, "the library"),
    A.click(libraryTab, { label: "Community" }),
    A.wait(1200),
  ],
  note: {
    text: "*Community* is where people post their plans. You can browse them here.",
    at: libraryTab,
  },
};

const newPlan: Step = {
  id: "new-plan",
  actions: [A.click(tourPlanTab, { label: "the Tour plan tab" }), A.wait(600)],
  note: {
    text: "Here's how you make a *new plan*.",
    at: css(".mt-plus"),
  },
};

const feedback: Step = {
  id: "feedback",
  actions: [closeMenus, A.wait(200)],
  note: {
    text: "That's everything! Found a bug, or have an idea? *Feedback* sends it from here. Questions about your own setup do well in GTNH Planner's thread on the *GT New Horizons Discord*.",
    at: feedbackKey,
  },
};

// endregion

export const STEPS: Step[] = [
  findRecipe,
  firstCard,
  mouseAround,
  keysAround,
  pinNumber,
  pinCount,
  pinInput,
  tierStep,
  powerStep,
  settingsStep,
  cloneStep,
  drawerFromPort,
  drawerFromItems,
  wiring,
  arrange,
  overview,
  colours,
  machinesStep,
  combine,
  undo,
  units,
  forcedAdd,
  forcedWired,
  forcedInput,
  forcedUses,
  forcedOutput,
  forcedSplit,
  trashStep,
  productStep,
  nonRecipe,
  minimapStep,
  stickyNote,
  ...(isLiveConfigured() ? [inviteStep] : []),
  plansStep,
  libraryStep,
  newPlan,
  ...(isLiveConfigured()
    ? [taskBoardStep, taskStep, planTaskStep, planTaskLinkStep, planTaskUpdateStep]
    : []),
  feedback,
];
