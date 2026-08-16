"use client";

import {
  Anchor,
  Box,
  Cable,
  Compass,
  Ellipsis,
  Focus,
  Gauge,
  Globe,
  Grid3x3,
  Link,
  MoveUpRight,
  Paintbrush,
  Palette,
  Presentation,
  Search,
  Share2,
  Sprout,
  Square,
  Tag,
  Trash,
  Trash2,
  Type,
  Undo2,
  User,
} from "lucide-react";
import type { GlanceRow } from "@/components/tour/card-parts";
import { openInspectorTab } from "@/lib/inspector-tab";
import { openSidebarTab } from "@/lib/sidebar-tab";
import { writeWorkspaceView } from "@/lib/workspace-view";
import {
  clearTheDecks,
  frameTourWholeBoard,
  frameTourBlocked,
  frameTourBottleneck,
  frameTourBufferDrawer,
  frameTourByproductDrawer,
  frameTourProductDrawer,
  frameTourSourceDrawer,
  openTourPlan,
  restoreDrawerLab,
  restoreTheDecks,
  restoreTourRateUnit,
  tuneTourRateUnit,
  tourBlockedInputsSelector,
  tourBlockedOutputsSelector,
  tourBlockedSelector,
  tourBlockedUsageSelector,
  tourBottleneckInputsSelector,
  tourBottleneckOutputsSelector,
  tourBottleneckSelector,
  tourBottleneckUsageSelector,
  tourBufferDrawerSelector,
  tourByproductDrawerSelector,
  tourLabArmQuiet,
  tourLabArmStrict,
  tourLabQuiet,
  tourLabReset,
  tourLabStrict,
  tourProductDrawerSelector,
  tourSourceDrawerSelector,
} from "./tour-boards";

/**
 * The guided walks behind the Welcome tab.
 *
 * A lesson is a list of steps, and a step is a place on the screen plus what
 * that place is for. The overlay (`TourOverlay`) does the pointing: it finds
 * the step's anchor, cuts a hole in a dimmed screen around it, and parks a card
 * beside it.
 *
 * An anchor is an id, not a selector. The overlay looks for
 * `[data-tour-anchor="<id>"]` first and falls back to `[data-help-anchor=...]`,
 * which the hover help sheet already puts on every toolbar and column, so most
 * steps cost no markup at all. Several elements may share one id; their
 * rectangles union, and anything hidden is skipped, so a folded compact toolbar
 * points at its trigger instead of at the invisible row above the board.
 *
 * WRITING A STEP. A wall of prose gets skipped, so a step is a short stack of
 * ROWS, and every row leads with the same mark the screen does: the button's
 * own icon, a key chip, or a little mouse with the right button lit. Keep a row
 * to one line's worth of words, put the words that matter between *asterisks*
 * so they come out lit, and let the icon carry the rest. Six rows is the most
 * any step should ever want.
 *
 * EVERY CLAIM MUST BE TRUE ON THE LIVE BOARD. The second lesson's steps were
 * checked against the posted titanium line with the real solver: what a full
 * input bar means, which card gets marked and why, what each flip in the
 * drawer lab actually changes. Rewrite a row only with the board open.
 *
 * `before` runs just ahead of the step and is for making the target visible:
 * opening a column, landing the sidebar on a tab. A step must never leave the
 * app somewhere the user then has to dig their way out of.
 */

/** Where a step's card sits relative to the thing it points at. */
export type TourSide = "top" | "bottom" | "left" | "right" | "inside";

export interface TourStep {
  /**
   * The `data-tour-anchor` / `data-help-anchor` id to point at. Left out, or
   * missing from the page, the card sits in the middle of a dimmed screen.
   */
  anchor?: string;
  /**
   * A CSS selector worked out at the moment the step runs, for pointing at
   * something that has no anchor because it did not exist until now: one card
   * of a plan the lesson has just downloaded. Read every frame, and it wins
   * over `anchor`.
   */
  anchorSelector?: () => string | undefined;
  title: string;
  rows: GlanceRow[];
  /** Preferred side. Ignored when there is no room for it. */
  side?: TourSide;
  /** Make the target reachable before the step is measured. */
  before?: () => void;
}

export interface TourLesson {
  id: string;
  /** Shown on the Welcome tab's card. */
  title: string;
  blurb: string;
  /**
   * Worth pressing even if you think you know the app.
   *
   * Stays on after the lesson has been completed, deliberately. The rules this
   * one teaches - what the words on a card mean, what each drawer shape asks
   * for - are the ones that CHANGE, and somebody who walked it three releases
   * ago is exactly the person who now believes something that is no longer
   * true. A badge that disappears the moment you have seen it once only ever
   * reaches people on their first day.
   */
  recommended?: boolean;
  /** Put something on the board worth pointing at, before step one. */
  setup?: () => void | Promise<void>;
  /** Undo whatever `setup` did to the layout, however the lesson ends. */
  teardown?: () => void;
  /** Offered as a second button on the last step: keep going into this one. */
  nextLessonId?: string;
  steps: TourStep[];
}

function showColumn(side: "left" | "right") {
  writeWorkspaceView(side === "left" ? { leftPanelOpen: true } : { rightPanelOpen: true });
}

/** Open the left column AND land it on one tab: the tour walks all three. */
function showSidebarTab(tab: "items" | "blueprints" | "setups") {
  return () => {
    showColumn("left");
    openSidebarTab(tab);
  };
}

/** Open the right column AND land it on one tab: Resources, then Machines. */
function showInspectorTab(tab: "resources" | "machines") {
  return () => {
    showColumn("right");
    openInspectorTab(tab);
  };
}

const LOOK_AROUND: TourLesson = {
  id: "look-around",
  title: "A look around the planner",
  blurb: "Where everything is: the board, every toolbar around it, and both columns.",
  nextLessonId: "read-the-board",
  steps: [
    {
      anchor: "board",
      side: "inside",
      title: "This is the board",
      rows: [
        { text: "Your factory gets built here." },
        { mouse: "left", text: "Drag the background to *move around*." },
        { mouse: "scroll", text: "Scroll to *zoom*." },
      ],
    },
    {
      anchor: "build",
      side: "bottom",
      title: "Build tools",
      rows: [
        { icon: Undo2, text: "Undo and redo. *Ctrl+Z*." },
        { icon: Sprout, text: "*Crop farm*: CropsNH (2.9)." },
        { icon: Trash, text: "*Trash can*: voids whatever is wired into it." },
        { icon: Gauge, text: "*Custom rate*: set any rate in or out by hand." },
        { chip: "/s", text: "Per tick, second, minute or hour." },
      ],
    },
    {
      anchor: "paint",
      side: "left",
      title: "Paint and notes",
      rows: [
        { icon: Paintbrush, text: "Pick a shade, then click cards to *paint them*." },
        { icon: Square, text: "Draw a *box* around a section." },
        { icon: MoveUpRight, text: "Draw an *arrow*." },
        { icon: Type, text: "Drop a *note*." },
        { icon: Trash2, text: "*Bin*: click anything to delete it." },
      ],
    },
    {
      anchor: "view",
      side: "left",
      title: "View options",
      rows: [
        { text: "These change *the view*, not the plan." },
        { icon: Grid3x3, text: "Background: dots, lines, crosses or none." },
        { icon: Palette, text: "Shade the wires by *how much they carry*." },
        { icon: Cable, text: "Thicken them the same way." },
        { icon: Ellipsis, text: "Moving dashes show *which way it flows*." },
        { icon: Tag, text: "Rate labels on the lines." },
        { icon: Anchor, text: "Wires dock anywhere, or at fixed ports." },
        { icon: Presentation, text: "*Calm colours*, for presenting a plan." },
      ],
    },
    {
      anchor: "glance",
      side: "left",
      title: "Framing",
      rows: [
        { icon: Focus, text: "*Fits the whole plan* on the screen." },
        { icon: Box, text: "Cards show *what they are*." },
        { icon: Gauge, text: "Cards show *how hard they run*: red is idle, green is full speed." },
      ],
    },
    {
      anchor: "inspector",
      side: "left",
      before: showInspectorTab("resources"),
      title: "What the plan needs",
      rows: [
        { text: "Fills with three lists once machines are on the board." },
        { chip: "INPUTS", tone: "need", text: "You have to bring this in yourself." },
        { chip: "OUTPUTS", tone: "output", text: "This leaves the plan." },
        { chip: "INTERNAL", tone: "internal", text: "Made and used right here." },
        { text: "Hover a row and every card carrying it *lights up*." },
      ],
    },
    {
      anchor: "inspector",
      side: "left",
      before: showInspectorTab("machines"),
      title: "A list of all machines used",
      rows: [
        { text: "One row per *machine at a voltage*. Same ones stack." },
        { text: "Hover a row and those cards *light up*." },
        { mouse: "left", text: "Double click *flies the board* to them." },
      ],
    },
    {
      anchor: "browser",
      side: "right",
      before: showSidebarTab("items"),
      title: "Every item in the pack",
      rows: [
        { icon: Search, text: "Search works like *NEI* in game." },
        { mouse: "left", text: "Left click asks *what makes it*." },
        { mouse: "right", text: "Right click asks *what uses it*." },
        { text: "Pick a recipe and the machine *lands on the board*, ready to wire." },
      ],
    },
    {
      anchor: "browser",
      side: "right",
      before: showSidebarTab("blueprints"),
      title: "Pockets: reusable groups",
      rows: [
        { chip: "Ctrl+G", text: "Select a few cards and they *fold into one pocket*." },
        { mouse: "left", text: "Double click a pocket to *step inside*. Esc backs out." },
        { chip: "✦", text: "This shelf holds your pockets and shared ones." },
        { text: "Place one from the shelf and it lands as *one card*, wires folded inside." },
      ],
    },
    {
      anchor: "tabs",
      side: "bottom",
      title: "One tab, one factory",
      rows: [
        { chip: "+", text: "A new empty board." },
        { mouse: "left", text: "Double click a tab to *rename* it." },
        { chip: "⋯", text: "Copy it, close it, or close every tab to one side." },
        { text: "Everything saves in this browser as you work." },
      ],
    },
    {
      anchor: "browser",
      side: "right",
      before: showSidebarTab("setups"),
      title: "Shared setups",
      rows: [
        { icon: Globe, text: "*Public*: every setup people have posted." },
        { icon: User, text: "*Mine*: the ones you have posted." },
        { mouse: "left", text: "Open one and it becomes *a new tab* you can edit." },
        { text: "Vote the good ones up so they are easier to find." },
      ],
    },
    {
      anchor: "share-setup",
      side: "right",
      before: showSidebarTab("setups"),
      title: "Share your own",
      rows: [
        { icon: Share2, text: "Shares *the board you have open*, under a name you pick." },
        { icon: Link, text: "You get a *link to send a friend*. It opens the setup in their planner." },
        { text: "It also appears on the Public shelf. You can take it down any time." },
        { text: "Needs an account: just a *username and password*." },
      ],
    },
    {
      anchor: "help",
      side: "right",
      title: "Help",
      rows: [
        { chip: "?", text: "Names *every button on the screen* at once." },
        { icon: Compass, text: "Rerun both tours from the *Welcome* tab, or right here." },
        { text: "The next tour opens a real factory and explains it." },
      ],
    },
  ],
};

/**
 * The second walk: the canvas and nothing else.
 *
 * It opens a real posted setup, says what the board is at arm's length, then
 * flies in on one machine and reads it out loud. The card it picks is the most
 * wired-up one that is NOT running flat out (see `pickCards`), so there is
 * always a real number to explain rather than a shrug.
 */
const READ_THE_BOARD: TourLesson = {
  id: "read-the-board",
  title: "Read the board",
  recommended: true,
  blurb:
    "Opens a real titanium line: what the words on the cards mean, what each drawer does, and two live changes to watch.",
  // Both columns out of the way for the duration: this lesson is about the
  // canvas and nothing else, and with them open there is not enough board left
  // to magnify a card into. They come back exactly as they were.
  setup: () => {
    clearTheDecks();
    // AFTER the plan opens, not before: switching to the tour's design tab
    // applies that design's saved view, rate unit included, which would
    // stamp straight over a dial turned any earlier.
    return openTourPlan().then(tuneTourRateUnit);
  },
  // The lab steps rewrite the plan to make their point. However the lesson
  // ends - finished, skipped, closed - the plan goes back exactly as it loaded,
  // and so do the rate dial and the columns.
  teardown: () => {
    restoreDrawerLab();
    restoreTourRateUnit();
    restoreTheDecks();
  },
  steps: [
    {
      anchor: "board",
      side: "inside",
      title: "A factory of boxes and wires",
      rows: [
        { text: "Every box is *one machine* doing *one recipe*." },
        { text: "Every wire is *one thing moving*, from whoever makes it to whoever needs it." },
        { text: "Everything else is detail on a box." },
      ],
    },
    {
      anchorSelector: tourBottleneckSelector,
      side: "right",
      before: frameTourBottleneck,
      title: "A recipe",
      rows: [
        { text: "Three parts, always in the same places." },
        { text: "*Left*: what it needs." },
        { text: "*Right*: what it makes." },
        { text: "*Bottom*: how hard the machine is running." },
      ],
    },
    {
      anchorSelector: tourBottleneckInputsSelector,
      side: "right",
      title: "The inputs are fine",
      rows: [
        { text: "One row per ingredient, with its arrival rate." },
        { text: "Full bars: everything this machine wants *arrives*." },
        { text: "Nothing here is holding it back." },
      ],
    },
    {
      anchorSelector: tourBottleneckOutputsSelector,
      side: "right",
      title: "The outputs fall short",
      rows: [
        { text: "One row per product, with its output rate." },
        {
          text: "The machine downstream wants *far more* of one of these than this machine can make.",
        },
        {
          text: "The *percentage* on an output row is how much of what was asked for actually arrived at the next machine.",
        },
      ],
    },
    {
      anchorSelector: tourBottleneckUsageSelector,
      side: "right",
      title: "Which makes this a bottleneck",
      rows: [
        {
          chip: "BOTTLENECK",
          tone: "bottleneck",
          text: "Fully fed and running at *100%*, and still not making enough.",
        },
        {
          text: "This word means *build more of this machine* or *raise its voltage*. Nothing upstream will help: it already has everything it wants.",
        },
      ],
    },
    {
      anchorSelector: tourBlockedSelector,
      side: "right",
      before: frameTourBlocked,
      title: "Now a different machine",
      rows: [
        { text: "Further down the chain." },
        { text: "Same three parts." },
      ],
    },
    {
      anchorSelector: tourBlockedInputsSelector,
      side: "right",
      title: "Only one input is the problem",
      rows: [
        { text: "The bars still look full: it gets all it asks for *at its current speed*." },
        {
          text: "One input is *marked*: the one whose supply sets that speed.",
        },
        { text: "Fix the marked one. The others are already covered." },
      ],
    },
    {
      anchorSelector: tourBlockedUsageSelector,
      side: "right",
      title: "Why it does not say bottleneck",
      rows: [
        {
          chip: "BLOCKED",
          tone: "blocked",
          text: "Slowed because it is not being fed enough.",
        },
        {
          text: "Adding more of *this* machine would not help. It cannot use what it already gets.",
        },
      ],
    },
    {
      anchorSelector: tourBlockedOutputsSelector,
      side: "right",
      title: "It slows the next machine too",
      rows: [
        { text: "What it makes is nowhere near enough." },
        { text: "The machine waiting on it gets *a fraction* of what it needs." },
        { text: "One shortage upstream becomes a whole chain of slowed machines." },
      ],
    },
    {
      anchorSelector: tourBottleneckUsageSelector,
      side: "right",
      before: frameTourBottleneck,
      title: "Two more status words",
      rows: [
        {
          chip: "NO WIRES",
          tone: "starved",
          text: "A slot has no wire, so the machine cannot run. The bare slots *flash white*. Wire them and the word goes away.",
        },
        {
          chip: "CLOGGED",
          tone: "blocked",
          text: "Wired up, but it makes more of something than anyone takes, and the extra has *nowhere* to go.",
        },
        {
          text: "When an output backs up the machine stops, as in game. Wire the spare to a *Byproduct* drawer or a *Buffer* and it runs again.",
        },
      ],
    },
    {
      anchor: "board",
      side: "inside",
      before: frameTourWholeBoard,
      title: "A line is not meant to run flat out",
      rows: [
        {
          text: "Almost nothing here sits at *100 percent*. A real line never does.",
        },
        {
          text: "Recipes want different rates, so most machines idle part of the time. That is normal.",
        },
        {
          chip: "BOTTLENECK",
          tone: "bottleneck",
          text: "The one to fix. *Add machines* or *raise voltage* there and the next bottleneck appears somewhere else.",
        },
      ],
    },
    {
      anchor: "board",
      side: "inside",
      before: frameTourWholeBoard,
      title: "Drawers decide",
      rows: [
        { text: "Machines make. *Drawers decide* what enters, what leaves, and what waits." },
        { chip: "SOURCE", tone: "need", text: "*Red, rounded*: never runs out. The plan's inputs." },
        { chip: "PRODUCT", tone: "product", text: "*Blue, square*: what the plan outputs." },
        { chip: "BYPRODUCT", tone: "output", text: "*Green, shield*: catches the spare." },
        {
          chip: "BUFFER",
          tone: "internal",
          text: "*Steel, hexagon*: flow passes through, and extra piles up here.",
        },
      ],
    },
    {
      anchorSelector: tourSourceDrawerSelector,
      side: "right",
      before: frameTourSourceDrawer,
      title: "A Source is infinite",
      rows: [
        { text: "Nothing feeds it, so it *creates* its item or fluid. These two feed the line." },
        {
          chip: "INPUTS",
          tone: "need",
          text: "Everything a Source hands out is something your real base must supply.",
        },
        { text: "Draw a wire *out* of any drawer into empty board and a Source appears to feed it." },
      ],
    },
    {
      anchorSelector: tourProductDrawerSelector,
      side: "right",
      before: frameTourProductDrawer,
      title: "A Product pulls",
      rows: [
        { text: "The *titanium ingot* drawer. Nothing draws from it, so it *asks*." },
        {
          chip: "PRODUCT",
          tone: "product",
          text: "It asks its machine for *everything it can make*. This sets the pace of the whole line.",
        },
        {
          text: "The button on its header flips it to a Byproduct. The next steps do exactly that.",
        },
      ],
    },
    {
      anchorSelector: tourByproductDrawerSelector,
      side: "right",
      before: frameTourByproductDrawer,
      title: "A Byproduct never asks for more",
      rows: [
        { text: "Two of them here: *cast iron* and *carbon monoxide*." },
        {
          chip: "BYPRODUCT",
          tone: "output",
          text: "A Byproduct *never asks its machine to speed up*, even when the machine could. It just catches whatever gets made.",
        },
      ],
    },
    {
      anchorSelector: tourBufferDrawerSelector,
      side: "right",
      before: frameTourBufferDrawer,
      title: "A Buffer catches",
      rows: [
        { text: "*Hot titanium ingot*, between the furnace and the freezer." },
        {
          chip: "BUFFER",
          tone: "internal",
          text: "It hands the freezer what the freezer pulls, and *stores anything extra*, at the rate shown on its tile.",
        },
        {
          text: "It never creates supply: run it short and the taker slows. Its header button can also make it *strict*. The steps ahead show both.",
        },
      ],
    },
    {
      anchor: "board",
      side: "inside",
      before: tourLabArmQuiet,
      title: "Next: the Product stops asking",
      rows: [
        {
          text: "*The blue titanium drawer is blinking*: it is the one about to change.",
        },
        {
          text: "Press *Next* and it becomes a Byproduct. Nothing on the board will ask for titanium after that.",
        },
        { text: "Watch the *freezer* and the *buffer*." },
      ],
    },
    {
      anchor: "board",
      side: "inside",
      before: tourLabQuiet,
      title: "The Product stopped asking",
      rows: [
        {
          text: "The titanium drawer is a *Byproduct* now. Nothing on the board asks for titanium any more.",
        },
        {
          chip: "UNUSED",
          tone: "internal",
          text: "*Only the freezer stopped.* Nothing asks for its ingots, so it has nothing to do.",
        },
        {
          text: "Everything upstream keeps running. The *Buffer stores* the hot ingots the furnace keeps making, at the rate on its tile.",
        },
        { text: "A Byproduct never sets the pace." },
      ],
    },
    {
      anchor: "board",
      side: "inside",
      before: tourLabArmStrict,
      title: "Next: the Buffer goes strict",
      rows: [
        { text: "Now *the Buffer is blinking*." },
        {
          text: "Press *Next* and it goes strict: it will *refuse to store the surplus* it has been catching.",
        },
        { text: "Watch the *furnace* first, then everything upstream of it." },
      ],
    },
    {
      anchor: "board",
      side: "inside",
      before: tourLabStrict,
      title: "The Buffer is strict",
      rows: [
        { text: "The Buffer now *refuses to store the surplus*." },
        {
          chip: "UNUSED",
          tone: "internal",
          text: "Nothing asks and nothing catches, so the furnace has *nowhere* to send its ingots. It stops, and every machine upstream follows. *The whole line reads zero.*",
        },
        {
          text: "Strict stores nothing, so an imbalance stops the line instead of hiding in a tank.",
        },
        { text: "Press *Next* to put everything back." },
      ],
    },
    {
      anchor: "board",
      side: "inside",
      before: tourLabReset,
      title: "Back on track",
      rows: [
        { text: "Product asking, Buffer catching. The line runs again." },
        {
          text: "Every drawer does one of three jobs: *ask, catch, or hold*.",
        },
        { text: "The header buttons flip a drawer's job in one click. No rewiring." },
      ],
    },
    {
      anchor: "sketch",
      side: "bottom",
      title: "Sketch mode",
      rows: [
        {
          text: "The wand is *sketch mode*: every unwired input is fed for free, and every unwired output is exported.",
        },
        {
          text: "Made for quick math on a half-built plan. Turn it off when you are ready to wire real drawers.",
        },
      ],
    },
  ],
};

export const TOUR_LESSONS: TourLesson[] = [LOOK_AROUND, READ_THE_BOARD];

export function findLesson(lessonId: string | undefined): TourLesson | undefined {
  return lessonId ? TOUR_LESSONS.find((lesson) => lesson.id === lessonId) : undefined;
}
