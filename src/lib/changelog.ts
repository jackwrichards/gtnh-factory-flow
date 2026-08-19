/**
 * What's new, in players' words.
 *
 * Read by people planning factories, not by developers: say what changed on
 * THEIR board, never how it was built. Newest first. ONE entry per release,
 * where a release is a deploy to the live site, not a commit (see version.ts).
 *
 * BE BRIEF. Every note is ONE short sentence naming what changed, and four
 * notes is the ceiling. No second sentence explaining what it used to do, no
 * reasoning, no reassurance: the reader either clicked the chip out of mild
 * curiosity or had the popup put in front of them uninvited, and neither of
 * them asked for an essay. If a change cannot be said in a line, it is
 * probably two changes or one nobody needs told about.
 *
 * The LIST, though, runs all the way back, and that is deliberate. The dialog
 * opens on the releases a given reader has not seen - usually one to four - and
 * keeps the rest behind a "full history" button, so length costs the impatient
 * reader nothing and answers "when did that change?" for everyone else. Do not
 * prune it back to a handful again; that only moved the wall from the archive
 * into the popup for anyone returning after a long break.
 *
 * An entry can also carry ACTIONS. A release that adds something you have to
 * DO to understand - a tour, a demo board - should offer it as a button rather
 * than describing it and hoping, because the reader is already right here with
 * the app open.
 */
export interface ChangelogAction {
  label: string;
  /** Starts this tour lesson and closes the dialog. */
  lessonId?: string;
  /** Or opens a link, for anything that lives outside the app. */
  href?: string;
}

export interface ChangelogEntry {
  version: string;
  /** ISO date, rendered in the reader's locale. */
  date: string;
  headline: string;
  notes: string[];
  /**
   * For a release that changed what the app MEANS rather than what it can do.
   *
   * Reserve it for the ones where a plan somebody saved months ago will now
   * read differently, because that reader has no reason to suspect anything
   * and every reason to think they have found a bug. Rendered loudly, with the
   * entry's actions inside it, so the warning and the thing that explains it
   * are one block instead of a sentence and a button that got separated.
   */
  warning?: string;
  /**
   * Show this release to EVERY browser once, whatever it has seen before.
   *
   * The ordinary rule needs a version stamp to compare against, and a browser
   * with no stamp is treated as a first visit and told nothing. That is right
   * for somebody genuinely new, and it was wrong for the release that
   * introduced the stamp: nobody had one yet, so a player who had used the
   * planner for months looked exactly like a stranger and the one release the
   * whole feature exists for was the one release nobody was shown.
   *
   * So this flag is not "important" - `warning` already says that. It is
   * specifically "do not trust the stamp for this one". Spend it on a release
   * that changes what the board MEANS, and expect to spend it roughly never;
   * once a browser holds a stamp the ordinary path is enough.
   *
   * Tracked separately from the stamp, so it fires exactly once per browser
   * and cannot repeat.
   */
  showToEveryone?: boolean;
  /** Offered as buttons under the notes. */
  actions?: ChangelogAction[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "2.17.1",
    date: "2026-08-18",
    headline: "Side panel fixes",
    notes: [
      "The resource list scrolls while a row is popped out wide.",
      "The popped out row stays clear of the scroll bar.",
      "The power list lost its stray sideways scroll bar.",
      "Power lines no longer show hover popups.",
    ],
  },
  {
    version: "2.17.0",
    date: "2026-08-18",
    headline: "Steam machines run at steam speed",
    notes: [
      "Steam machines now show their real speed: bronze builds run slower than LV, high pressure builds twice as fast as bronze.",
      "Every steam card shows the litres of steam it burns per second.",
      "The power list totals your steam and EU, and can switch between peak and average draw.",
      "Machines like the Volcanus no longer look faster and cheaper than they run in game.",
    ],
    warning:
      "Steam plans read slower now. The old numbers showed every steam machine at twice its real speed.",
  },
  {
    version: "2.16.3",
    date: "2026-08-18",
    headline: "Machines only run on what actually arrives",
    notes: [
      "A machine fed by a clogged supplier now runs at what its wire delivers, not at full speed.",
      "A slowed machine draws less of its other ingredients too, so drawers drain at the true rate.",
      "The card names the input that holds it back.",
      "A card's inputs and outputs no longer disagree about its speed.",
    ],
    warning:
      "Some saved plans read lower now. The old numbers counted material that never actually arrived, so the new ones match what the machines build in game.",
  },
  {
    version: "2.16.2",
    date: "2026-08-18",
    headline: "Pocket cards work again",
    notes: [
      "Pocket cards show their ports and rates again, with sketch mode on or off.",
      "Saved blueprints list what they need and make again.",
    ],
  },
  {
    version: "2.16.1",
    date: "2026-08-17",
    headline: "The overclock story, in plain words",
    notes: [
      "The power tooltip is wider, so its lines stop wrapping oddly.",
      "It says whether a machine overclocks the regular way or the perfect way, and what that trades.",
      "It ends plainly: what the machine runs at, and what the next overclock would take.",
    ],
  },
  {
    version: "2.16.0",
    date: "2026-08-17",
    headline: "Power explains itself",
    notes: [
      "Hover the tier chip, the hatch counter or the power cell for the whole power story.",
      "The tooltip diagrams each overclock and stays up while you click the chips.",
      "Crowded cards lift the parallel chip onto its own footer row.",
      "Sharing a setup now photographs your board, so pasted links show the plan itself.",
    ],
  },
  {
    version: "2.15.0",
    date: "2026-08-17",
    headline: "Real power: hatches, overclocks and new board views",
    notes: [
      "Machine speeds, overclocks and power checked against the game's own code.",
      "Multiblock cards get an energy hatch dial, a power readout and an underpowered warning.",
      "The right panel lists every machine to build, with its tier and power.",
      "Zoomed out, the board can colour cards by speed, by reason or by power tier.",
    ],
  },
  {
    version: "2.14.1",
    date: "2026-08-14",
    headline: "The site introduces itself to AI assistants",
    notes: [
      "Asking an AI assistant about GTNH planning has a better chance of pointing here.",
    ],
  },
  {
    version: "2.14.0",
    date: "2026-08-14",
    headline: "The planner gets its own icon",
    notes: [
      "A new icon in the browser tab, in bookmarks, and on home screens.",
      "The site introduces itself properly to search engines and link previews.",
    ],
  },
  {
    version: "2.13.0",
    date: "2026-08-14",
    headline: "Cards show their circuit setting",
    notes: [
      "Every machine card carries its circuit slot in the bottom corner, next to the machine count.",
      "A recipe that needs a circuit shows it; an empty slot means any setting works.",
      "Presentation view shows the slot too.",
    ],
  },
  {
    version: "2.12.1",
    date: "2026-08-14",
    headline: "The link card leads with the plan's icon",
    notes: [
      "A shared link's preview now shows the plan's icon large instead of listing inputs and outputs.",
    ],
  },
  {
    version: "2.12.0",
    date: "2026-08-14",
    headline: "Exports get a preview, a nameplate, and a GIF",
    notes: [
      "The export button opens a dialog: live preview, any theme's paper, and a summary bar naming the plan and what it needs and makes.",
      "GIF export replays the flowing dashes as a seamless loop.",
      "A plan link pasted in chat now unfurls as that plan: its name, its words, and a card of its own.",
      "Exports render in the right font and paper again, and offscreen cards no longer go missing.",
    ],
  },
  {
    version: "2.11.7",
    date: "2026-08-13",
    headline: "The recipe book stops keeping you waiting",
    notes: [
      "Opening what makes or uses an item answers in moments, not minutes.",
      "Recipe pages you have seen before come back instantly, even after a reload.",
    ],
  },
  {
    version: "2.11.6",
    date: "2026-08-12",
    headline: "Every stalled loop gets its restart",
    notes: [
      "A loop that had wound down to a crawl now climbs back to full speed instead of reading DEAD LOOP.",
    ],
  },
  {
    version: "2.11.5",
    date: "2026-08-12",
    headline: "A filling tank counts as an output",
    notes: [
      "A tank catching more than its takers drink now shows in Outputs at its fill rate.",
      "Tanks that pass everything along, and strict tanks, stay out of the list.",
      "A loop that returns its cells through one shared drawer now climbs to full speed instead of stalling partway, strict or not.",
      "A stalled loop can no longer show spare cells appearing from nowhere.",
    ],
  },
  {
    version: "2.11.4",
    date: "2026-08-12",
    headline: "A loop that breaks even now runs",
    notes: [
      "A loop that returns exactly what it uses, like cells through canners and back, now runs instead of reading DEAD LOOP.",
      "Loops that genuinely lose material still read DEAD LOOP until something feeds them.",
    ],
  },
  {
    version: "2.11.3",
    date: "2026-08-12",
    headline: "Crop farms count every drop",
    notes: [
      "Crops with chanced drops, like Blazereed or the bonsais, now show their full average yield.",
      "Raising the voltage tier on a crop card no longer speeds the crop up.",
    ],
  },
  {
    version: "2.11.2",
    date: "2026-08-12",
    headline: "The plus button answers the moment you press it",
    notes: [
      "The recipe book closes as soon as you press plus, with a small chip over the board while the recipe is on its way.",
      "If a recipe cannot be fetched, the board says so instead of doing nothing.",
      "Recipes you have hovered or added before now land instantly.",
    ],
  },
  {
    version: "2.11.1",
    date: "2026-08-12",
    headline: "The board decides when wires follow",
    notes: [
      "Wire-following during a drag now steps aside by itself on boards too big or too slow for it, instead of riding the smooth movement button.",
    ],
  },
  {
    version: "2.11.0",
    date: "2026-08-12",
    headline: "The palette speaks the board's language",
    notes: [
      "Six new paint colours: the board's own alarm red, warning amber, output green, product blue and two card greys.",
      "Dragging notes and boxes no longer stirs the wires, and mid-drag rerouting turns off with the smooth movement button.",
    ],
  },
  {
    version: "2.10.0",
    date: "2026-08-12",
    headline: "Share it, make it yours, and watch it move",
    notes: [
      "Share buttons now sit next to Import and Export and on the new plan bar, which holds a plan's icon, name, description and votes.",
      "The board has textured papers now: charcoal, blueprint, chalkboard, parchment and more, picked from the view tools.",
      "Boxes and zones take their own border and fill styles, and your own pictures can go on the board.",
      "The board is alive: cards glide onto the grid, wires follow while you drag, and every rate eases into place, with two view buttons to turn it off.",
    ],
  },
  {
    version: "2.9.1",
    date: "2026-08-11",
    headline: "The tours tell it straight",
    notes: [
      "Both guided tours were rewritten so every claim matches what the board really does.",
      "The Read the board tour now explains what a full input bar means on a slowed machine.",
      "The first tour now covers the calm colours button and uses the panel's real headings.",
    ],
    actions: [{ label: "Walk the board tour", lessonId: "read-the-board" }],
  },
  {
    version: "2.9.0",
    date: "2026-08-11",
    headline: "Copy what your board is doing",
    notes: [
      "Export menu, top of the page: Copy diagnostics puts a readable summary of your plan on the clipboard.",
      "Select some cards first and it copies only those, with what the group needs and what it makes.",
      "Paste it into a bug report and whoever reads it can see the problem without your board.",
      "A plan with recycling loops no longer settles a notch below the rate it can really reach.",
    ],
  },
  {
    version: "2.8.0",
    date: "2026-08-11",
    headline: "Drawers wire from anywhere",
    notes: [
      "Grab a drawer anywhere on its face. Drop it on something that eats the item and it feeds it; drop it on something that makes the item and it fills up.",
      "Dropping a wire slightly off, on the wrong row of a card, now lands on the row that fits instead of doing nothing.",
    ],
  },
  {
    version: "2.7.0",
    date: "2026-08-11",
    headline: "Highlights and menus",
    notes: [
      "Point at a drawer: it lights its own wires and the slots they plug into, and no longer pulses.",
      "Slots, drawers and wires light in one colour, and everything that pulses now pulses together.",
      "Tab menu reads plainly: *Close tabs to left / right / other tabs / Close*. Menus shut when you click the board.",
      "The right panel's first list is called *Inputs*.",
    ],
  },
  {
    version: "2.6.0",
    date: "2026-08-11",
    headline: "The right panel adds up",
    notes: [
      "Products and byproducts are one *Outputs* list again: one row per item, the whole rate that leaves your line. The drawers on the board keep their two jobs.",
      "New *RAW / NET* switch above the list: on NET, an item that is both needed and produced shows as one number, on the side its sign says. An item fully covered by its own line reads +0 in Outputs: nothing to source.",
      "It is display math only. Nothing moves on the board, and switching back to raw shows both figures again.",
      "Internal starts folded. It is the long tail; one click opens it.",
    ],
  },
  {
    version: "2.5.0",
    date: "2026-08-11",
    headline: "Drawers wire to drawers",
    notes: [
      "A drawer can feed a drawer. Wire a *source into a buffer* and it covers exactly what the buffer's takers are short, so a recycling loop keeps its make-up line on the board.",
      "When the loop makes *more* than it eats, that source just sits at 0/s. No more deleting it to dodge a dead loop and then finding you cannot put it back.",
      "A drawer wired into a *product or byproduct* drawer hands over whatever its takers leave, so one catch can split into an export with no machine in between.",
      "Dragging off a drawer into empty space makes a *source* wired into it. A drawer already catches its own extra, so what space adds is supply.",
    ],
  },
  {
    version: "2.4.1",
    date: "2026-08-11",
    headline: "Plainer tooltips and tours",
    notes: [
      "Every tooltip, help card and tour step is shorter and plainer.",
      "Nothing on your board behaves differently.",
    ],
  },
  {
    version: "2.4.0",
    date: "2026-08-10",
    headline: "One big tour that flips drawers live, and loops that blame the right machine",
    notes: [
      "The board tour grew: after reading the machines it now walks *every drawer job*, then flips the product off and the buffer strict, *live*, with the whole board following each flip.",
      "It also says the quiet part: cards under 100% are *a factory working, not broken*. The one worth hunting is the bottleneck.",
      "A ring that stopped because its *supplier* stopped now says exactly that, names the machine, and sends you to it. Only a ring dying of its own losses reads DEAD LOOP.",
      "New drawer shapes: *products are squares, byproducts shields, buffers hexagons*, so the product and byproduct swap keeps its buttons still. A catching buffer wears a *dashed ring*; a strict one is solid.",
      "Every grey browser tooltip is now the planner's own: same words, proper panel, no delay.",
    ],
    actions: [{ label: "Take the tour", lessonId: "read-the-board" }],
  },
  {
    version: "2.3.0",
    date: "2026-08-10",
    headline: "Loops run, buffers hold the extra, and a wand for sketches",
    notes: [
      "Recycling loops work. A byproduct fed back into an earlier machine is *used up first* and the fresh supply line slows to make room. Boards that collapsed to 0% run now.",
      "A buffer *catches what its takers leave* instead of backing up the machine, and its tile shows *how fast it is filling*. It still never invents supply: a shortfall slows the taker, so wire a source in for make-up.",
      "New wand button, top left: *sketch mode*. Every unwired input is fed for free and every unwired output is exported, so a rough idea shows numbers before you draw the boundary.",
      "Drawers, tanks and trash cans are *smaller tiles*, coloured and shaped by their job: *red imports, blue products, green byproducts, steel buffers*. The word on the tile still says it outright.",
    ],
    warning:
      "A machine that used to read CLOGGED into a buffer runs now, and the buffer fills instead. A tank filling forever is not free storage: speed its taker up, or set the buffer to *strict* on its header button to get the old stop back.",
  },
  {
    version: "2.2.1",
    date: "2026-08-10",
    headline: "Wires into a trash can stay put",
    notes: ["A line into a trash can was *deleted when the plan loaded*. It survives now."],
  },
  {
    version: "2.2.0",
    date: "2026-08-10",
    headline: "Product drawers ask for everything now",
    notes: [
      "A product drawer asks its machine for *its full speed*, not just for whatever turned up. Machines that cannot keep up say *how many more you need*.",
      "A buffer no longer makes a machine look *short of an ingredient* when it is really backed up on an output.",
    ],
  },
  {
    version: "2.1.0",
    date: "2026-08-10",
    headline: "A thing can be a need and a byproduct at once",
    notes: [
      "Bringing carbon in at one drawer while spare carbon lands in another now lists *both*, instead of subtracting one from the other.",
      "Products and byproducts each show *what their own drawers caught*.",
      "Fixed: a machine wired to *a product drawer and a byproduct drawer* on one output sat at 0%.",
    ],
  },
  {
    version: "2.0.2",
    date: "2026-08-10",
    headline: "Drawers stop talking to each other",
    notes: [
      "Two drawers holding the same item were treated as *one shared container*, even with no wire between them.",
      "So a new line making an item could *starve an old line* that imported it.",
      "Every drawer is now *its own container*, and shows *its own numbers*. To move things between two, wire them.",
    ],
  },
  {
    version: "2.0.1",
    date: "2026-08-10",
    headline: "Rates per tick",
    notes: ["The rate switch has a fourth setting: */t*, the unit the game itself quotes."],
  },
  {
    version: "2.0.0",
    date: "2026-08-10",
    headline: "Every slot has to be wired now",
    notes: [
      "A slot with no wire *stops the machine*. It reads *NO WIRES*.",
      "Spare output needs somewhere to go, or the machine holds back and reads *CLOGGED*.",
      "Drawers do four jobs, each its own shape: *SOURCE*, *BUFFER*, *PRODUCT*, *BYPRODUCT*.",
      "A product *pulls its machine flat out*. A byproduct *takes what is spare*.",
      "Hovers give you *the state and one line why*, not a table.",
      "The side panel splits *Products from Byproducts*, each with its own colour.",
      "*Old boards will light up with slots to connect.* Nothing is broken.",
    ],
    warning:
      "*Your saved setups will act different.* Some machines will have stopped until you say where things go.",
    // The release that introduced the version stamp, so no browser alive has
    // one to compare against. Without this, nobody sees these notes at all.
    showToEveryone: true,
    actions: [{ label: "Take the tour", lessonId: "read-the-board" }],
  },
  {
    version: "1.42.1",
    date: "2026-08-09",
    headline: "A link to someone's setup opens the setup",
    notes: [
      "Following a link someone sent you now lands you straight on their factory. The welcome page used to come up over it, so the setup was sitting there in a tab behind and the link looked like it had failed.",
      "The tab it arrives in is named after the setup, so you can tell it from your own work at a glance. It used to say Untitled design.",
      "Opening a setup from the Setups shelf while the welcome page is up now does the same thing: the page steps aside and shows you what you opened.",
    ],
  },
  {
    version: "1.42.0",
    date: "2026-08-09",
    headline: "Crop farms know who is picking the crop",
    notes: [
      "A crop farm now says who is picking the crop. The Manager dropdown starts at By Hand and runs up through every Crop Manager tier, and each tier shakes the loot table 5% harder than the last.",
      "A Crop Manager also tells you how far it reaches. An LV one works 11x11 crop sticks on each of the five layers it covers, an UV one 39x39, so the card can say how many machines your seeds actually need.",
      "An Industrial Farm is the other place a crop can live, so it gets its own tab. It brings its own water, fertilizer and sky, so those three settings disappear: there is nothing left for you to set. In their place you get the seed bed tier and its upgrade units, and the card will not fit more units than the structure has room for.",
      "The settings on a crop or bee card now sit under a heading that names the machine, and you can fold them away by clicking it. A folded card keeps the setting, so a board full of crops you have already tuned can be as short as you like.",
      "Hover the card and it now says how many machines your seed count actually needs, and what they draw.",
      "Cards you already have start on By Hand, so nothing on your board moves until you choose otherwise.",
    ],
  },
  {
    version: "1.41.1",
    date: "2026-08-09",
    headline: "A dry crop is worth nothing, and now says so",
    notes: [
      "On a crop farm, the Water and Fertilizer menus claimed an empty crop still fed it one point. It feeds it none. The rates were always worked out correctly, so nothing on your board changes: only the two labels were wrong.",
    ],
  },
  {
    version: "1.41.0",
    date: "2026-08-09",
    headline: "Every tab keeps its place",
    notes: [
      "Each design now remembers where you were looking on it and how far in you were zoomed. Switch to another tab and back, or reload the page, and you carry on at the machine you were working on instead of at the whole factory zoomed out.",
      "A tab you have not opened before still arrives with the plan framed, and so does a setup someone shared with you.",
    ],
  },
  {
    version: "1.40.1",
    date: "2026-08-09",
    headline: "Reloading keeps you on the design you were on",
    notes: [
      "Refreshing the page used to drop you back on the Welcome tab. Now it leaves you where you were, and Welcome only greets you when you open the planner fresh.",
    ],
  },
  {
    version: "1.40.0",
    date: "2026-08-08",
    headline: "Machine rates now match the game",
    notes: [
      "Parallels are paid for with power before any speed from a higher tier. A chem plant with titanium pipe casings on IV spends all of it on its six parallels, so nitrobenzene reads 2,000 L/s instead of 32,000 L/s, which is what the machine really does.",
      "Machines no longer stall when a recipe gets down to one tick. A Boldarnator on EV makes 128 cobble/s, the same as one measured in game, and it keeps climbing above IV instead of sitting at 20/s.",
      "The Multiblock Dehydrator has a coil slot at last. Its coils are worth a 5% power saving every 900K and a free speed doubling every 1,800K, and it runs at 220% speed on half the power.",
      "The Multiblock Mixer was offering the wrong casings. It takes item pipe casings, tin through black plutonium, not the fluid ones.",
      "Arc furnace electrodes, cutting factory sawblades, electromagnets, anvils, containment blocks, maceration chips and laser amperage are all pickable now. Pick the part and the rates follow.",
      "49 multiblocks are on figures checked against the game's code, up from none a week ago. The Welcome tab lists the ones that are not there yet.",
      "Some plans will read lower than before and some higher. Either way the new number is the one your factory will actually hit.",
    ],
  },
  {
    version: "1.39.0",
    date: "2026-08-08",
    headline: "A Welcome tab, and two guided tours",
    notes: [
      "There is a Welcome tab at the head of the tab strip now, the way an editor has one. It has the tours on it, a couple of quick ways to start, and your designs. Untick the box at the bottom and it stops opening on it.",
      "The first tour walks you round the whole screen: the board, all four toolbars, both columns, the tabs, and where sharing lives. It dims everything except the thing it is talking about and points at it, and Esc leaves at any point.",
      "The second one teaches you to read a card. It opens a real titanium line off the shelf, clears the side columns out of the way, and flies right in on one machine: what the left side is asking for and which ingredient is actually holding it back, what the percentage on the right is really telling you, and what FULL, STARVED, BOTTLENECK and BLOCKED each mean in the machine's own words. It finishes on drawers, which trip people up: what one actually is, and the case for using one, pointing at a drawer on that line that is quietly keeping a machine at 100%. It arrives as a tab of its own so nothing you were working on is touched, and your columns come back when it ends.",
      'The "?" in the bottom left corner has had the same treatment. It was a wall of small print; it is now the same cards the tours use, saying much less, and the tours themselves are sitting on it so you can start one from the corner you already go to when you are stuck.',
      "Closed the Welcome tab and want it back? The compass in the top right, or Welcome and tours in the menu on a phone.",
    ],
  },
  {
    version: "1.38.3",
    date: "2026-08-08",
    headline: "Inside a pocket, the trail is at the top where you can see it",
    notes: [
      'On a phone the "Board ▸ Pocket" trail was sitting a fifth of the way down the screen with empty board above it, because it was keeping clear of the tool buttons. It takes the top line now and the tool buttons step down a line instead.',
      '"Compact into pocket" moved to the bottom of the board on a phone, where a thumb can reach it, rather than competing for the top line with everything else.',
    ],
  },
  {
    version: "1.38.2",
    date: "2026-08-08",
    headline: "The tier dropdown filters the search and nothing else",
    notes: [
      'Setting a maximum voltage tier in the recipe book used to also put a red ring and a "TIER REQUIRED" warning on every card on your board above that tier. Narrowing a search is not a judgement about your factory, so it no longer says anything about it. The dropdown still hides recipes above the tier you pick, which is all it was ever for.',
    ],
  },
  {
    version: "1.38.1",
    date: "2026-08-08",
    headline: "The recipe book's head reads in the order you decide things",
    notes: [
      "On a phone the book now opens with the item, the Makes and Uses buttons, and the way out all on its first line, and the machine underneath them. It read backwards before: you would pick a machine, then find the Makes and Uses switch below it, and changing that changed the machine list above. The mode comes first because it decides what machines there are to pick from.",
      'The "Recipes for" caption is gone. The two buttons say which one you are looking at, and you can press them.',
      "The close button moved up beside the item's name, where a window's close button belongs, rather than sitting on the machine's row looking like it would close the machine.",
    ],
  },
  {
    version: "1.38.0",
    date: "2026-08-08",
    headline: "Uses, from the items list and from inside the book",
    notes: [
      'Tapping an item in the items column now asks which question you meant: what makes it, or what uses it. On a phone "uses" was simply unreachable there, since a tap could only be one of the two and there is no second mouse button to hold in reserve. Holding opens the same menu. A mouse still goes straight there with its left and right buttons.',
      'Inside the recipe book, the caption that said "Recipes for" or "Uses of" is now a pair of buttons that switch between them, so you can turn a recipe list into a uses list without going back to the search. On desktop it sits at the top of the category rail; on a phone it is on the bar under the name.',
      "That bar has stopped trying to fit the category name on a phone: it was already in the dropdown right above it, and the pair of them were crushing the machine icons.",
      "The Recent shelf is one row of smaller icons on a phone, so it stops eating the results above it.",
      "The two buttons in the press-and-hold menu look like buttons now.",
    ],
  },
  {
    version: "1.37.2",
    date: "2026-08-08",
    headline: "One wire between two slots, not two",
    notes: [
      "Custom rate cards were the worst of it: every drag onto one added another line, so a card could sit under five wires stacked on the same pixels, each carrying a fifth of the rate you dialled. A card now takes one wire per slot, and offering it the same slot again changes nothing.",
      "Two machines could double up the same way, most often over a link the board had already made for you. That drag now unwires instead of laying a second line on top.",
      "Plans already carrying doubled lines are tidied up the next time they open.",
    ],
  },
  {
    version: "1.37.1",
    date: "2026-08-08",
    headline: "The placement flash is easier to catch",
    notes: [
      "It waits half a second before starting, so it is not competing with the card appearing and the panel sliding away, then pulses four times slowly instead of twice quickly. It washes the whole card now rather than only outlining it, which on a board made of framed cards is the difference between noticing and not.",
    ],
  },
  {
    version: "1.37.0",
    date: "2026-08-08",
    headline: "Whatever you just placed says where it is",
    notes: [
      "Anything landing on the board now flashes: a machine, a crop farm, a trash can, a custom rate, a drawer, a pocket, a pasted selection, a blueprint. On a big plan a new card is otherwise indistinguishable from the two hundred already there.",
      "On a phone, placing something also closes the panel you placed it from, because that panel was covering the board it just landed on.",
    ],
  },
  {
    version: "1.36.3",
    date: "2026-08-08",
    headline: "The phone stops fighting the board",
    notes: [
      "Pinching and double tapping used to zoom the WEB PAGE as well as the board, including from the top bar where there is nothing to zoom, and a drag that began near the top armed pull-to-refresh, so a double-tap-and-drag zoom could reload the app. The board owns those gestures now.",
      "Holding a slot no longer raises the blue text selection band and the copy menu over half the screen. On a touchscreen nothing outside a text field is selectable now, because the menu that opens under your finger was the next thing it found to select.",
      "A tap on a slot opens its two answers, the same menu a press and hold opens. Choosing one no longer opens the other as well, and the drawer it opens in no longer closes itself the instant it arrives.",
      "The swipe-out zone for the side panels was a third of the board, which swallowed drags meant for the canvas. It is a thumb's width at the very edge now, still the full height of the board.",
    ],
  },
  {
    version: "1.36.1",
    date: "2026-08-08",
    headline: "Asking a slot works with the column closed, and the press shows itself",
    notes: [
      "Clicking a slot, or pressing R or U on one, did nothing at all unless the items column happened to be open: the answer was being written into a panel that was not on screen. Asking now opens the column it answers in, on desktop and on a phone.",
      'Pressing and holding a slot lights it up straight away, so you can see the press registering rather than waiting to find out. Holding no longer starts a wire it then drops somewhere unintended, and you can slide from the press straight onto "what makes it" or "what uses it" and let go there to pick it. Letting go first and tapping still works.',
      "Recipes in the book fill the width of the column on a phone instead of sitting small in the middle of it, at nearly twice the size.",
    ],
  },
  {
    version: "1.36.0",
    date: "2026-08-08",
    headline: "Every slot answers now, and the board takes a finger properly",
    notes: [
      "Click anywhere on an input or output row to see what makes that resource, right click for what uses it. It used to be the little item icon only, which was a 28px target for the question you ask most. Dragging from the row still pulls a wire, exactly as before.",
      "With the pointer over a row, R opens what makes it and U opens what uses it. No aiming at all.",
      "On a touchscreen, press and hold a row for a small menu with both.",
      "Double tap the board to zoom in on the spot you tapped. Double tap and slide up or down to zoom in and out smoothly, like a map. Pinching still works.",
      "Swiping a drawer out no longer means hitting the little tab: a swipe in from anywhere down the left or right side of the board pulls that side's drawer out, and it follows your thumb. With one open, a swipe anywhere at all puts it away.",
      "On a touchscreen a card now moves only after you tap to select it. Dragging an unselected card pans the board, so a plan too dense to have gaps in it can still be moved around.",
      "Hover panels no longer stick to the screen on a touchscreen. A tap makes the browser pretend a mouse arrived, so every tooltip you crossed opened and then had nothing to close it, and they piled up until the next tap. They only answer a real pointer now.",
    ],
  },
  {
    version: "1.35.2",
    date: "2026-08-08",
    headline: "The wide resource row, actually on the row",
    notes: [
      "Pointing at a resource still drew the wide copy of it low, and stopped it dead at the edge of the column instead of letting it reach over the board. It is now drawn straight onto the page rather than from inside the column, so nothing above it can move it or cut it off.",
      "The star and eye now fade in as the row widens, and the rate slides across to make room for them instead of jumping there before the row has finished growing.",
      "Each row only widens as far as its own name needs. Every one used to slide the same distance whatever it was called, so short names swung out over the board for nothing; now a name that already fits does not move at all, and a long one gets exactly the room it needs to be read in full.",
    ],
  },
  {
    version: "1.35.1",
    date: "2026-08-08",
    headline: "The wide resource row lands on the row you point at",
    notes: [
      "Pointing at a resource redraws it wide so you can read the whole name and reach its buttons. On a short window it was landing beside the row rather than on it: the app insisted on 720px of height, so on a laptop the page itself scrolled, and everything measured against the window came out a scrollbar's width off. It now fits whatever window it is given, which also keeps the board's bottom-corner buttons on screen.",
      "The wide row sticks to its row while the list scrolls, and stays out of the way when the row is only half in view.",
    ],
  },
  {
    version: "1.35.0",
    date: "2026-08-08",
    headline: "The planner fits on a phone",
    notes: [
      "On a narrow screen, or a phone held sideways, the top bar keeps only the app name and everything else moves behind the menu button on the right: the pack version, cleaning the board, importing, the three export formats, the links and your account. It used to run a long way off the edge of the screen, which made your phone shrink the whole page to fit.",
      "The items and resources columns are now drawers that slide over the board, and they follow your finger: drag one out from the tab on either edge, or tap it, and throw it back out again with a swipe. The two words printed sideways down the edges are gone, so the board gets that space back.",
      "The board's buttons fold into three: build, paint and view. Tap one and its row unfolds on the line below, clear of everything else. Undo and redo stay out in the open where a mistake can find them.",
      "A new button in the bottom right corner puts the whole plan back on the screen, zoomed to fit, however far you have wandered off. It is there on desktop too, and the React Flow badge that used to squat in that corner is gone.",
      "In the items column, the filters fold away behind a button beside the grid switch, and Recent is a single row on a phone instead of eating a third of the list.",
      "The help behind the question mark opens as a page you can scroll on a phone, instead of pointing arrows at buttons that are folded away.",
      "The design tabs are a third shorter on every screen. The text was never filling them.",
    ],
  },
  {
    version: "1.34.1",
    date: "2026-08-08",
    headline: "The items column, tidied up",
    notes: [
      "One set of filters instead of two rows that looked like they combined. You pick one: All, Items, Fluids, Placed, Plants or Bees. The list and grid switch moved up beside the search box, since it changes how results are drawn rather than which ones you get.",
      "Icons in the grid are much bigger. The art always had a wide empty margin around it; the cell now crops that away instead of drawing it.",
      "The Recent shelf sits on a card of its own, uses the same size icons as the grid, and no longer hugs the bottom of the window.",
      "Scrolling anywhere in the column turns the page, so you can flick through results without going for the arrows.",
      "While an icon is still loading you get a quiet outline instead of the item's name printed in a font far too big for the box. Icons that arrive quickly show nothing at all.",
    ],
  },
  {
    version: "1.34.0",
    date: "2026-08-08",
    headline: "The search box forgives you, and crops are recipes now",
    notes: [
      'Searching finally works the way you type. Plurals find the singular, so "oak logs" finds Oak Log. Spelling mistakes get fixed for you: "vaccum tube" finds the Vacuum Tube, "steal ingot" finds Steel. Two words run together still work, and nicknames like "ebf" find the Electric Blast Furnace. Names now beat registry ids, so the item you meant is at the top.',
      "Crops are real recipes. Look up Oak Log and a Crop Farm sits in the list next to the machines, so you can see a crop can grow it. Click it and the crop card lands ready to run, with the crop already picked. No more hunting for the sprout button and setting one up by hand.",
      "New filters under the search box: only what is already on your board, only what a crop or tree can grow, only what bees make.",
      "A Recent strip along the bottom of the items column remembers the last things you looked up, so coming back to the same ingredient is one click. In the icon grid, hovering an item now names it and says which mod it is from.",
      "Hovering a slot that rotates through the items it accepts used to answer with the whole list of them, twice, wrapped over the card. It now names the one item you are pointing at. Scrolling that slot no longer makes the tooltip vanish, so you can spin through the options and read each one.",
    ],
  },
  {
    version: "1.33.2",
    date: "2026-08-08",
    headline: "Your crop farm logs go into the machines that want logs",
    notes: [
      "A bonsai crop makes a real Oak Log, but the Coke Oven, Pyrolyse Oven, Macerator and Lathe all ask for the any-wood version of it, and the board would not let you join the two. It does now, for every wood: oak, spruce, birch, jungle, acacia and dark oak.",
      "The same thing was quietly blocking thousands of other recipes that accept any damaged or coloured version of an item, so a few chains you gave up on should join up now too.",
    ],
  },
  {
    version: "1.33.1",
    date: "2026-08-08",
    headline: "You can actually click the colours now",
    notes: [
      "The colour picker opened underneath the row of view buttons below it, so half the colours were showing but could not be clicked. It now opens over the top of everything.",
      "It is also a wide strip of two rows instead of a tall block, so you can see every colour at once and it covers far less of the board.",
    ],
  },
  {
    version: "1.33.0",
    date: "2026-08-08",
    headline: "A painted card is painted all the way through",
    notes: [
      "Paint a card and every part of it takes the colour: the name bar, the item boxes, the plugs, the usage and machine boxes, the dropdowns and the little block beside them, the machine tabs on top, the close and copy buttons. Bits kept getting left behind on the old dark grey, and each fix found a new one.",
      "Each colour has its own set of shades now, written down rather than worked out on the fly. A card keeps exactly the light and shade an unpainted card has, so text is as easy to read on a yellow card as on a grey one, and the bright ring around the outside is what tells you the colour from across the board.",
      "Pockets and crop farms are built from the same sets, in purple and green, so every card on the board is put together the same way.",
      "What a card is telling you never takes the paint: a starved input, a plug that is short, the tier badge and the delete button keep their own colours on every card.",
    ],
  },
  {
    version: "1.32.1",
    date: "2026-08-08",
    headline: "Presentation mode keeps a card's colour",
    notes: [
      "On a painted card, presentation mode turned the input and output plugs black while the rest of the card stayed its colour. Quieting a plug now takes it to that card's own dark shade, so the card reads as one thing.",
      "Output plugs on a painted card were also missing the colour in normal mode. They have it now.",
    ],
  },
  {
    version: "1.32.0",
    date: "2026-08-08",
    headline: "Custom rate cards let go, and every wire out of one shows",
    notes: [
      "Wiring a custom rate card to a machine drew no line at all. The rate counted and the machine ran on it, but the board showed nothing between the two cards until you reloaded. The line now appears the moment you let go, and so does any wire on a card that changes what it holds: a different machine, a different alternative for a slot, a swap inside a pocket.",
      "A custom rate card holds its resource only while something is wired to it. Pull the last wire and it goes back to a blank card with two sockets, ready for whatever you drag onto it next. Before, a card that once carried water carried water for ever and quietly refused everything else.",
      "You can also just drop something else on a card that is already wired, and it becomes that instead.",
      "The rate you dialed and the supply/request choice now live on the card, so they survive all of it. The dial is on a blank card too: set it up first, then wire it.",
      "Painting a card now colours the whole card. The name bar, the item chips, the boxes along the bottom and the arrow in the middle all go to a dark shade of the colour you picked, so a red card is red all the way through and everything on it is still easy to read. Before, the paint reached the item chips and nothing else, and the usage and machine boxes stayed black on every colour.",
      "Pockets, crop farms and custom rate cards are built the same way now: purple, green and blue cards with their own dark panels. Custom rate cards were a pale blue with white writing on it, which was the hardest thing on the board to read. Cards you already have change with them.",
    ],
  },
  {
    version: "1.31.0",
    date: "2026-08-08",
    headline: "A cell is an item, and a Canner is a machine you place",
    notes: [
      "Cells and fluids used to swap for each other for free. Drag a cell output onto the board and you got a tank measured in litres, and a fluid would quietly satisfy a slot that wanted cells. Your plan looked finished while leaving out a Canner, the empty cells to run it, and the power to run that.",
      "Now a cell is an item and a fluid is a fluid. To go from one to the other, place a Canner and wire it up, the same as you would in game. Most recipes exist in both a cell version and a fluid version, so usually you can just pick the one that matches what you already make.",
      "The old swap guessed that every cell holds 1000 L. Hundreds of them do not: every molten metal cell is 144 L, so those chains were reading about seven times too high. Those numbers are right now.",
      "Opening an older plan removes wires that crossed a cell and its fluid, and the slot settings that came with them. The chain will read short exactly where a Canner is missing, which is where to put one. Your drawers and tanks stay on the board.",
    ],
  },
  {
    version: "1.30.1",
    date: "2026-08-08",
    headline: "New cards stay in the pocket you are standing in",
    notes: [
      "Drag a drawer or tank out of a slot while inside a pocket and it landed on the main board instead, wired to a machine you could no longer see. It now appears where you are working.",
      "The same went for every new card: machines added from the recipe book, drawers added from the resource list, and notes. All of them jumped out to the main board. They stay put now.",
      "Pockets you already built are unchanged. Anything that escaped is still on the main board, so drag it back in.",
    ],
  },
  {
    version: "1.30.0",
    date: "2026-08-08",
    headline: "The recipe book fits your screen, and shows the circuit setting",
    notes: [
      "The book now takes the room it has instead of a fixed size, and follows the window as you resize it. On a laptop it is roughly twice as wide as before, which is what it needed: the add button and the output slot used to be cut off the right edge and there was no way to reach them.",
      "On a phone it fills the screen and shows one recipe at a time, drawn as large as the screen allows. Nothing is cut off any more. The category list becomes a dropdown when there is no room for it, and Escape or the new X closes the book.",
      "Each recipe now carries its own add button and its time on the recipe panel itself, so a card is only as wide as the recipe it draws. Small recipes take small cards, and more of them fit side by side.",
      "Machines that need their circuit dialled to a number now show that circuit in the recipe, marked as something the machine keeps rather than eats. Over thirty thousand recipes were missing it, so they looked like they would run on any setting.",
      "Recipes no longer show the energy per craft, which was only ever repeating what the tier already tells you.",
    ],
  },
  {
    version: "1.29.0",
    date: "2026-08-07",
    headline: "Slots that take more than one item now show it, and let you choose",
    notes: [
      "A slot that accepts more than one item now rolls through them the way it does in game, about one a second. The Circuit Assembler recipe for an Electronic Circuit rolls its resistor slot between a resistor and an SMD resistor, and its fluid between 72 L of soldering alloy, 144 L of tin and 288 L of lead. The amount changes with the item, so the machine always asks for the right quantity.",
      "Hover a rolling slot to hold it still and read it. Scroll on it to step through the choices yourself, which stops the roll and settles on your pick. The corner mark turns from a cyan plus to an orange square once a slot is set.",
      "Adding the recipe uses whatever the slot was showing at that moment, so you can either aim for the one you want or just take what comes up.",
      "A slot that takes one exact item is left alone. The vacuum tube in that same recipe still says vacuum tube, because that is all the machine will accept.",
      "None of this was visible before. Every slot looked like it demanded one exact item, and an Any LV Circuit slot named a stand-in you cannot craft without ever saying which circuits would do.",
    ],
  },
  {
    version: "1.28.0",
    date: "2026-08-07",
    headline: "A machine can feed itself",
    notes: [
      "Plenty of machines put out the same item they take in. You can now wire one straight back into itself: drag from the output and drop it anywhere on the same machine, or aim at its own input slot. The wire loops around the card so the round trip is easy to see.",
      "The board always knew how to work these out, it just would not let you draw one. A loop that makes more than it eats keeps itself running. A loop that loses a little each pass winds down to nothing and wears the red dead loop ring, the same as a ring built from several machines.",
      "Setting machine counts automatically used to run away on a machine that loses a little of the item it feeds itself, asking for an impossible number of machines. It settles properly now.",
    ],
  },
  {
    version: "1.27.3",
    date: "2026-08-07",
    headline: "Every outline sits on the card, and selection always shows",
    notes: [
      "On a machine with a row of machine tabs above it, outlines were drawn around the tabs as well, so the card looked like it was sitting inside a box with empty space along the top. The red dead loop ring, the purple selection ring, the search glow and the over-tier warning all hug the card itself now.",
      "Selecting a machine in a dead loop shows the purple ring again. The red was drowning it, and a click that does not visibly land is a click you make twice.",
      "Outlines stack instead of hiding each other. A card that is selected and over tier wears both, purple inside red, so nothing is lost by picking it up.",
    ],
  },
  {
    version: "1.27.1",
    date: "2026-08-07",
    headline: "Dead loop markers blink together and hold their width",
    notes: [
      "Machines in the same loop blink in time again. They used to drift apart depending on when each one came on screen, which made a ring read as unrelated things flashing.",
      "Zoomed out, the ring thinned to nothing at the dim end of each blink and looked like it was flickering. It keeps its width now, and gets thicker the further out you go.",
    ],
  },
  {
    version: "1.27.0",
    date: "2026-08-07",
    headline: "The Blueprints tab is now the Pockets tab",
    notes: [
      "Everything on that shelf is a pocket: you save one from a pocket card and you place one back as a pocket card. Calling it a blueprint in between was a second name for the same thing.",
      "So it says pocket now, everywhere it used to say blueprint, and the tab wears the pocket star instead of the stack of sheets.",
      "Nothing moved and nothing was lost. Everything you saved is still there under the new name.",
    ],
  },
  {
    version: "1.26.0",
    date: "2026-08-07",
    headline: "Open a setup and the board goes to it",
    notes: [
      "Open someone else's setup and the board now flies to their factory and zooms out until all of it is on screen. People build a long way from where you happen to be looking, so opening one used to drop you on empty canvas with the whole thing off the edge.",
      "Importing a plan file lands the same way.",
      "Drop a setup onto your board as a pocket and the camera settles on the new card. Same for placing one off your pocket shelf: you see what just arrived, however far out you were reading the board.",
      "The board zooms out further than it used to, so even a very large factory fits on one screen.",
    ],
  },
  {
    version: "1.25.0",
    date: "2026-08-07",
    headline: "The board now tells you when machines are stuck in a loop",
    notes: [
      "Wire a set of machines so they feed each other in a ring, and if more leaves the ring than comes back round it, every machine in it falls to 0%. That is what would happen in game, and the planner was already right about it. It just never said why.",
      "Now it says so. Every machine caught in a dead ring reads DEAD LOOP and pulses red, and so do the wires between them, so you can see the whole circle at a glance. A line along the bottom names it and takes you to it.",
      "Hover any of those machines for the long version: what is going round, why it drains, and how to start it. The short answer is to put a source or a stocked barrel on any machine in the ring.",
      "This catches rings of any size, a machine wired back into itself, and rings that would hold on their own until something taps them for a couple of items a second.",
      "It stays quiet about rings that work. A ring that makes enough to keep itself going is a good build and gets no warning.",
      "Watch for this the moment you close the last wire on a loop. An input with nothing wired to it is assumed hand fed, so a ring can look perfectly healthy right up until you connect it and it has to supply itself.",
    ],
  },
  {
    version: "1.24.0",
    date: "2026-08-07",
    headline: "Machines only go red when they are the thing to fix",
    notes: [
      "Running below 100% is not a fault. A machine that hands every machine it feeds exactly what was asked now reads as fine, whatever its percent says.",
      "Starved, in soft yellow, means it is short on an ingredient but nothing is waiting on it. There is nothing to do.",
      "Blocked, in amber, means it is short and something downstream goes without because of it. The fix is further up the chain, and the hover says where.",
      "Bottleneck, in red, means everything it needs arrives and it still cannot keep up. That is the card to add machines to. Follow the amber cards upstream and you always land on a red one.",
      "A machine that misses a rate you set for it now counts as something going without, rather than reading as merely short.",
    ],
  },
  {
    version: "1.23.0",
    date: "2026-08-07",
    headline: "New parts to pick, and 61 machines now on checked numbers",
    notes: [
      "Machines that were missing a part you can choose have one now: arc furnace electrodes, cutting factory sawblades, electromagnets, anvils, item pipe casings, containment blocks, maceration upgrade chips, laser amperage and more. Pick the part and the rates follow.",
      "61 multiblocks now use figures checked against the game's code rather than read off tooltip text, up from about 45.",
      "The Industrial Arc Furnace was treated as a blast furnace and ran far too fast. It now runs on its electrodes, which is what actually drives it.",
      "Steam machines and the fusion reactors are not converted yet and are unchanged.",
    ],
  },
  {
    version: "1.22.0",
    date: "2026-08-07",
    headline: "Machine numbers now come from a checked list, not from reading tooltips",
    notes: [
      "The planner used to work out what coils and casings do by reading each machine's tooltip text. That guessed wrong often enough to matter, so around 45 multiblocks now use figures checked against the game's own code instead.",
      "Speed, power discount, parallels and overclock behaviour are all covered for those machines. Everything else keeps working exactly as before.",
      "Some numbers will move. Where they do, the new one is the one your factory will actually hit.",
      "Thanks to ShadowTheAge, whose open source GTNH calculator these figures are taken from.",
      "Found a rate that looks wrong? The Report Bug button in the header is now hard to miss, and it asks for a link to your published setup so it can be checked against your actual board.",
    ],
  },
  {
    version: "1.21.1",
    date: "2026-08-07",
    headline: "Machines with parallels no longer claim impossible output",
    notes: [
      "Parallels are paid for with power before any speed bonus from a higher tier. A chem plant with titanium pipe casings running nitrobenzene on IV spends all of it on its six parallels, so it now shows 2,000 L/s instead of 32,000 L/s, which is what the machine really does.",
      "Feeding a machine a higher tier only speeds it up if there is power left over once every parallel is running. Below that, extra voltage does nothing, exactly as in game.",
      "A machine can only run as many parallels as its power will carry. Six parallels of a 480 EU/t recipe need 2,880 EU/t, so on HV you get one.",
      "The chem plant, pyrolyse oven, oil cracker and coke oven were being paid a heat bonus meant for the blast furnace, and ran up to four times too fast. Only the blast furnace, Volcanus and the Exothermic Hearth get that bonus now.",
      "If a plan of yours drops after this update, the old number was wrong and the new one is what you will actually build.",
    ],
  },
  {
    version: "1.21.0",
    date: "2026-08-06",
    headline: "Pocket cards now read like machine cards",
    notes: [
      "Every resource going in or out of a pocket has a bar and two numbers: what it is moving right now, and the most it could move if it got everything it asks for.",
      "That second number comes from running every machine inside the pocket, not from scaling one figure, so a pocket short on one ingredient shows you exactly how much output you are losing.",
      "An ingredient with nothing wired to it now says HAND-FED, and each output tells you who is drinking from it, the same as any machine.",
      "A pocket that wanted one thing under two names used to show it twice, the second time with no rate at all. It is one row now.",
      "Pockets light up when you point at a resource in the list on the right. They used to stay dark.",
      "Dragging a resource off a pocket onto empty board makes a drawer. It quietly did nothing before.",
    ],
  },
  {
    version: "1.20.1",
    date: "2026-08-06",
    headline: "The item search sits in the same box as the other two tabs",
    notes: [
      "Items now keeps its search and filters in the rounded panel that Pockets and Setups already used, so all three tabs match.",
    ],
  },
  {
    version: "1.20.0",
    date: "2026-08-06",
    headline: "Three new buttons in the header",
    notes: [
      "The code, the Discord thread and a bug report are now one click away, up beside the import and export buttons.",
      "Reporting a bug opens a short form that asks the right questions instead of an empty box, and it already knows which planner version you are on.",
      "You can drag an exported plan straight into that form. The picture carries your whole board, so whatever went wrong can be opened and seen exactly as you had it.",
    ],
  },
  {
    version: "1.19.2",
    date: "2026-08-06",
    headline: "Close a whole run of tabs at once",
    notes: [
      "The tab menu can now close everything to the right, everything to the left, or every other tab, and each one says how many it will take.",
      "Closing tabs cannot be undone, so each of those asks once before it goes ahead.",
      "Game version moved up to the top bar, next to the app version, and its dropdown is wider so the name fits.",
      "Design tabs are a little shorter, so they sit closer to the text.",
      "The arrow that folds the left column away now sits on the far left, matching the one on the right.",
    ],
  },
  {
    version: "1.19.1",
    date: "2026-08-06",
    headline: "Calm mode now tidies pocket cards too",
    notes: [
      "With calm colours on, a pocket card drops its buttons like every other card and just shows its name across the top.",
      "The delete, clone, open, save and unpack buttons come straight back when you turn calm colours off.",
      "Double-clicking a pocket still opens it, and the card and its wires do not move.",
    ],
  },
  {
    version: "1.19.0",
    date: "2026-08-06",
    headline: "A shared setup now arrives set up the way you left it",
    notes: [
      "Sharing a setup saves how you had everything arranged, and opening someone else's puts it back exactly like that.",
      "That covers your starred resources and their charts, what you had hidden, whether hidden mode was on, and whether you were reading rates per second, per minute or per hour.",
      "It also covers the board: the background pattern, calm mode, the wire colour, thickness, label and flow settings, which card face you were on, and which side columns were open.",
      "Updating one of your own posts re-saves the arrangement too, so it never keeps the one from whenever you first published it.",
      "None of this touches your own designs. Switching between your tabs leaves your settings exactly where you put them, and dropping a setup onto the board you are working on will not rearrange anything.",
      "Older setups that were shared before this simply open with your own settings, as they always did.",
    ],
  },
  {
    version: "1.18.0",
    date: "2026-08-06",
    headline: "No more phantom shortages of a hundred-thousandth",
    notes: [
      "A resource that one machine makes and another eats in equal measure now reads as balanced, instead of sometimes turning up under Need or Output with a number like -0.0000012.",
      "Those came from rounding, not from anything wrong with your plan, and they got bigger the bigger your rates were. They are gone at every scale now.",
      "Real shortages and real spare output are untouched.",
      "Rates in the resource list now sit right against the edge of the panel instead of stopping short.",
      "The Need, Output and Internal headings dropped their explanatory lines.",
      "Hovering a resource no longer pops up the browser's own tooltip trailing your cursor down the list.",
      "A resource chart only shows a number while you are pointing at a point on it, since the row above already says what it is right now.",
      "A very long name still ends in an ellipsis when even the widened row cannot fit it.",
    ],
  },
  {
    version: "1.17.0",
    date: "2026-08-06",
    headline: "The question mark in the corner now explains every button",
    notes: [
      "Hover the ? bottom left and each toolbar card lists its buttons one by one, next to the very icon each one wears. No more guessing which is which.",
      "The crop farm, the trash can and the custom rate tap get a line each. So do all seven view switches, both card faces, and every paint and note tool.",
      "The left column says what its three tabs are for: Items, Pockets and Setups.",
      "The undo, clean, import and export buttons up top were never explained at all. They are now.",
      "The whole sheet went from bright cyan to a soft blue grey, so it reads as notes over your board instead of shouting at you.",
    ],
  },
  {
    version: "1.16.0",
    date: "2026-08-06",
    headline: "Double click a resource to fly to the machine that makes it",
    notes: [
      "Double click any resource and the board flies to a machine that uses it, centred and back at normal zoom. Double click again to step to the next one.",
      "Machines carrying the resource you are pointing at now glow and breathe, so they stand out on a busy board instead of just wearing a thin outline. They light up zoomed out too.",
      "Clicking a resource no longer locks the highlight on. Point at it to light the board, look away and it goes out.",
      "Hover a resource and it widens out over the board, so long names are readable in full.",
      "The charts moved: each starred resource now carries its own graph right underneath it, and there is a new button to hide or show all of them at once.",
      "Hover a graph to read what the number was at any point in its history.",
      "The resource panel got wider, and its rates now follow the per second, per minute and per hour switch like the rest of the board.",
      "Starred resources cannot be hidden. Starring something that was hidden brings it straight back.",
      "Selected machines wear the same purple as the selection panel, instead of cyan.",
      "Graphs step aside while you have a selection: the history follows your whole plan, not each selection you might make.",
    ],
  },
  {
    version: "1.15.0",
    date: "2026-08-06",
    headline: "Hide what you do not care about, watch what you do",
    notes: [
      "Hover any resource and two buttons appear: a star to watch it, an eye to hide it.",
      "Hidden resources drop out of the list. The eye button at the top brings them back greyed out, so you can find one and unhide it.",
      "Starred resources float to the top of their group and keep a star beside the name.",
      "New Watching panel at the foot of the list: every starred resource gets its own chart.",
      "The charts run along your edits, not along the clock. Each change that moves a number adds a point, so after an edit that shifted fifty things you can see which of them went up and which went down.",
      "Each chart shows spare above the line and short below it, with the change since the chart started.",
      "Both side columns fold away now. Use the arrow beside Game version on the left, or the one in the resources toolbar on the right, and a thin strip stays behind to bring them back.",
      "Your stars, your hidden resources and your folded columns are remembered between visits.",
    ],
  },
  {
    version: "1.14.0",
    date: "2026-08-06",
    headline: "Select part of your factory, see what just that part needs",
    notes: [
      "Pick some cards and the panel on the right switches to them alone: what they need, what they make, what stays inside.",
      "It works out the answer as if the rest of the board was not there, so anything piped in from outside now shows up under Need.",
      "The panel wears a purple ring while it is showing a selection, so you always know which numbers you are reading.",
      "Click an empty bit of the board to go back to the whole plan.",
      "Shift click now adds a card to your selection instead of starting over. Shift drag still lassoes, and Ctrl click still works too.",
    ],
  },
  {
    version: "1.13.0",
    date: "2026-08-06",
    headline: "The community hub moved in next door",
    notes: [
      "The Community page is gone. Everyone's shared factories now live in a Setups tab, right beside Items and Pockets.",
      "Browse, search, sort and upvote without leaving your board. Hover a setup to read its story: what it needs, what it makes.",
      "One click opens a setup as its own design tab, so it never lands on top of your work. Your own posts sit under Mine.",
      "Or drop a setup straight onto the board you have open: the box button lands the whole thing as one pocket card, wired and ready.",
      "Setups wear tags now, just like pockets: search with #tag, pick from the new tags dropdown, or tag your own posts from the shelf or the share dialog.",
      "Every setup shows its top voltage tier in that tier's own colour, the same badge machines wear on the board.",
      "Your own posts get a globe button, same as pockets: click to take a setup private or publish it again. Private posts keep their votes and downloads.",
      "The two shelves speak one language now: Mine and Public tabs, matching buttons, and every button explains itself when you hover it.",
      "Both shelves grew a share button beside Mine and Public. On Setups it shares the board you have open. On Pockets it asks for a pocket: click one and it lands on your shelf.",
      "Setups and pockets can wear an item's face now: click the little square left of a name and pick an icon. The picker offers the build's own ins and outs first, with full search under them.",
      "Saving a pocket to the shelf confirms in one dialog: name, icon, tags, what it needs and makes, and a tick box to publish it the moment it saves. The pocket card's save button, the share flow and overwriting all land there.",
      "Hover any row on either shelf and one card tells the whole story: the full name, who made it and when, cards and machines with the tier badge, the description, then what it needs on the left and what it makes on the right.",
      "Pockets show their top voltage tier too now, in the same coloured badge setups wear.",
      "Your own setup rows grew a save button too: the tab you have open replaces the post's contents, after an are-you-sure that names both.",
      "The share dialog says plainly what you are posting: the open tab, its cards, machines and power, then the post's icon, name, description and tags.",
      "The header's share and link buttons retired. Sharing lives on the shelves now, and every row carries its own copy-link button.",
      "Old community links still work: they open the shared setup straight in the planner.",
    ],
  },
  {
    version: "1.12.0",
    date: "2026-08-06",
    headline: "Pocket dimensions, a pocket shelf, and a board that explains itself",
    notes: [
      "Shift+drag a box around machines, then Ctrl+G: they compact into one pocket card carrying the group's ins and outs. Double-click it to step inside its own purple room. Esc steps back out.",
      "Pocket cards wire like machines: one port per resource at the boundary. Compacting warns first when it would pool supplies that came from different places.",
      "A Pockets tab now sits beside the item search: save a pocket to it, publish it, browse and vote on everyone else's, and place one straight onto your board.",
      "Pockets take tags and search by them. Rename in place, overwrite one from your board, and double-click a public row to download it.",
      "Drawers, tanks and trash cans went dark and wear their item's colour. Zoomed out, hovering one shows its item and rate.",
      "Zoomed way out the board becomes an LED wall: card faces glow their item's colour with bright rims, and wires light up gold to match.",
      "Box select got real: drag, then copy, cut, paste, delete and undo the whole selection at once.",
      "The zoom buttons are gone; the scroll wheel does that job. In their corner lives a question mark: hover it and every toolbar and panel explains itself, with a cheat sheet of the mouse and key moves.",
    ],
  },
  {
    version: "1.11.2",
    date: "2026-08-05",
    headline: "Dots, pills and dashes all know their place now",
    notes: [
      "Steering dots refuse to sit on a machine: drag one over a card and it rides the nearest clear grid corner instead — dropping it there is where it stays.",
      "Rate labels only appear where there is open wire to sit on, and the moving dashes pass underneath them instead of marching across.",
      "Wires and their dashes stay off the machine tabs at the top of a card — they land on the card itself, past the tabs.",
    ],
  },
  {
    version: "1.11.1",
    date: "2026-08-05",
    headline: "One click rewires the whole board",
    notes: [
      "Flipping the anchor between free docking and classic ports now redraws every wire at once — no more waving the mouse over each machine to wake its wires up.",
    ],
  },
  {
    version: "1.11.0",
    date: "2026-08-05",
    headline: "A show-off mode, and machines you can recognise from orbit",
    notes: [
      "New screen button in the board toolbar: presentation mode. The warning colours calm down to steel, the fix-it dials and buttons step aside, and every card slims to its name, its rates and a machine count — made for showing a build off.",
      "Machine tabs sit on top of the card like real tabs now, and in presentation mode the chosen machine rides up there as one big icon.",
      "Zoomed way out, cards now show what they ARE — the machine's icon, big. Hover one and a full-size readout opens with the machine, its count and everything going in and out. Two buttons in the bottom right switch between this and the classic usage view with the distance map.",
      "The side panel now opens straight onto your resources — needs, outputs and internal flows — with the power figures retired.",
    ],
  },
  {
    version: "1.10.1",
    date: "2026-08-05",
    headline: "Wires you can actually see",
    notes: [
      "Every wire is about twice as thick — the thinnest lines were reading as scratches.",
      "Thickness-by-volume mode has eight width steps now instead of four, so a 5k line and a 10k line look different even with a 100k pipe on the same board.",
    ],
  },
  {
    version: "1.10.0",
    date: "2026-08-05",
    headline: "Wires live on the grid — and you can steer them",
    notes: [
      "Every wire now travels along the grid, keeps a clear gap off every card, and never draws on top of another wire. Wires heading the same way ride side by side like a cable run.",
      "Double-click a wire to pin a dot on it. The wire must pass through the dot — drag it (it clicks along the grid) to steer the wire wherever you want, and double-click the dot to remove it. Dots save with your plan.",
      "Wires attach wherever on a card routes cleanest. The anchor button switches back to classic port attachment; it asks first on big boards since rewiring everything can take a moment.",
      "Direction cues got calmer: the marching dashes move slower, and when you turn them off, small arrows sit near each end of every wire instead.",
      "Rate labels on wires are now behind the tag button, off by default — the ports carry the numbers.",
      "Dragging feels honest now: the card in your hand rides above the wires, everything holds still while you drag, and the real wiring lands the moment you drop. Double-click no longer zooms the board.",
    ],
  },
  {
    version: "1.9.0",
    date: "2026-08-05",
    headline: "The whole board is built on one grid now",
    notes: [
      "Every machine, drawer, tank and trash can is now an exact number of grid squares wide and tall, and always sits on a grid square. Boards line up on their own instead of needing you to nudge cards into place.",
      "Item and fluid slots line up with the grid too, so the same slot on two different machines sits at the same height.",
      "The grid lock button is gone — it is always on. Plans you made before this update snap onto the grid the first time you open them.",
      "Machines are all one width now, so a long recipe name no longer makes a card wider than the one next to it.",
      "The EU/t figure has left the bottom of every card. It is still in the power panel on the right, where the whole plan's draw is.",
      "Nothing at the bottom of a card gets cut off any more: if a machine needs more room, the card grows by a whole square instead of squeezing.",
    ],
  },
  {
    version: "1.8.0",
    date: "2026-08-05",
    headline: "Drop a wire anywhere on a machine and it finds the right slot",
    notes: [
      "You no longer have to land on the exact little slot. Drag from any item or fluid and let go anywhere on the machine you want it to go to — the wire snaps onto whichever slot takes it.",
      "While you are dragging, every card tells you the answer up front: a soft green wash means that machine takes what you are holding, a soft red one means it does not.",
      "The pipe you are drawing commits as soon as you are over a green card — it jumps straight to the slot it is going to land in instead of trailing your cursor across the machine.",
      "Drawing a wire is now its own mode. The board stops reacting to everything else while you hold one: lines and their labels do not light up as you sweep past, slots stop highlighting, and no tooltips open. The only thing that answers is the machine you are pointing at.",
      "Letting go on a red card now does nothing at all, instead of dropping a drawer on top of it.",
      "The site is dark all the time now. The light theme and the switch in the header are gone.",
    ],
  },
  {
    version: "1.7.0",
    date: "2026-08-05",
    headline: "Hover a machine, see how far everything else is from it",
    notes: [
      "Zoomed out, resting on any machine now colours the whole board by how many wires away each other machine is from it. Its direct neighbours glow hot, and the colour fades further out along the chain.",
      "Every card shows that count while you hover, so you can tell two steps from five without squinting at colours. Anything not connected to the machine you are on goes grey and empty.",
      "Drawers, tanks and buffers do not add distance. A machine feeding another one through a drawer counts as one step away, not two, because the drawer is where the items wait rather than somewhere the chain goes.",
      "Wires fade back while you are reading the map, and everything snaps back to normal the moment you move away, zoom in, or drag the board.",
    ],
  },
  {
    version: "1.6.0",
    date: "2026-08-05",
    headline: "Zoom out and read the whole factory at once",
    notes: [
      "Zoomed out, machines now show one big number: how hard they are running. Red means starved, amber means more is being asked of it than it can give, plain means fine — so a whole plan reads as a health map at a glance instead of a wall of unreadable cards.",
      "Drawers, tanks and trash cans do the same, showing a large picture of what is inside. Zoom back in and everything returns exactly as it was.",
      "At that distance lines drop their rate chips, arrowheads and moving dashes too — none of it could be read at that size, and leaving it out makes zoomed-out boards far smoother.",
      "Big plans are quicker everywhere. Opening one takes about half as long, and boards that used to crawl while panning or zooming now keep up.",
      "The moving dashes used to keep the whole board busy redrawing itself even when you were not touching it. They no longer do, so a plan left alone now costs nothing.",
      "A few wires take tidier paths than before. The planner was throwing away most of what it knew about neighbouring lines while working out where each one should go; now it sees all of them, and the route you get is the same every time.",
    ],
  },
  {
    version: "1.5.0",
    date: "2026-08-04",
    headline: "Lines that stop piling up",
    notes: [
      "Wires running the same way no longer land on top of each other. Every line leaving a machine, and every line arriving at one, now gets its own track instead of picking one at random — so a machine with four outputs shows you four lines, not two.",
      "Thick lines keep their distance. With line thickness on, wires now leave more room around machines and around each other, instead of using the spacing meant for thin ones and ending up squeezed against the cards.",
      "Where one line crosses another it hops over it with a visible bump, and it is always the thinner line that does the hopping. Those bumps used to go missing on some crossings depending on how the board happened to draw itself, and sometimes appeared on the line hidden underneath; now every crossing gets one and you can always see it.",
      "When lines do overlap, the thinner one stays on top and every line has a darker outline, so you can still follow each one through the pile instead of losing it.",
      "Thick lines are easier to point at — hovering anywhere on a fat pipe now lights it up, instead of only a narrow strip down its middle.",
    ],
  },
  {
    version: "1.4.1",
    date: "2026-08-04",
    headline: "Cell recipes asked for 1000× too much",
    notes: [
      "Wiring anything into a recipe that takes filled cells multiplied what it needed by a thousand: a reactor wanting 2 Sulfuric Gas Cells a second asked for 2,000, and every machine feeding it looked far too small.",
      "Cells and their fluid are the same stuff counted two ways — one cell is 1000 L — and the planner was converting even when it did not need to. It now converts only when you actually wire a fluid into a cell slot, or the other way round.",
      "Plans you already saved are repaired when you open them. Nothing to redo.",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-08-04",
    headline: "Watch your factory run",
    notes: [
      "Lines now show what they carry: the busier a line, the thicker it is, with dashes marching along it in the direction things flow. Both are on from the start, and both have a button in the top right if you want them off.",
      "Two more views up there: colour every machine by how hard it is working, and colour every line by how much moves through it. Red is idle, green is flat out.",
      "Undo and redo buttons in the top left, a grid lock that snaps nodes as you drag, and a background you can switch between dots, lines, crosses or nothing.",
      "Boxes and arrows you draw no longer shove your wires around — they are drawings again, not walls. Text notes can be resized with + and − when you hover them.",
      "Your view settings stick between visits, and a coloured node keeps its text readable instead of going dark on dark.",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-08-03",
    headline: "Smaller nodes, straighter answers",
    notes: [
      "Nodes take up far less room. Icons, ports and couplings are all tighter, so more of your factory fits on screen at once — the name and rate still read on every input and output.",
      "Bottlenecks fed through a tank or drawer were never marked. The machine said it was starved but no ingredient turned red, and every one of them claimed something else was to blame. The real one is now highlighted.",
      "Hovering the usage box lights only what is actually holding the machine back, instead of everything on the card that looks unhappy.",
      "An output going nowhere now says where it ends — TRASH, TANK or STORE — instead of calling every one of them a dump.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-08-03",
    headline: "Nodes read at a glance",
    notes: [
      "Every node now ends in one line: USAGE with the percentage, and REASON with one word for why — bottleneck, over-asked, on demand, full or hand-fed. The big coloured banner is gone.",
      "Hover the usage box and the port it blames lights up, with the full story behind it: what it gets, what it wants, where to add machines, and what caps the node next.",
      "Item and fluid icons are much larger, ports carry the resource name, and huge numbers finally fit: 2,147,483,648 EU/t reads as 2.15G, and a slow line at 0.004/s no longer shows as zero.",
      "Wires can be dragged straight from an output's coupling chip, and the machines you can switch to now sit in tabs across the top of the node.",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-08-03",
    headline: "Trash cans",
    notes: [
      "New trash can in the top-left tools: wire any output into it and that flow is voided.",
      "Trashed resources disappear from the Output list, so it only shows what your factory really produces.",
      "One can takes as many lines as you like, and it only ever eats leftovers — machines that want the resource are always served first.",
    ],
  },
  {
    version: "1.0.3",
    date: "2026-08-02",
    headline: "Tanks and drawers behave",
    notes: [
      "Drag a wire from the glass, drag the frame to move the buffer.",
      "The minus button deletes again, and long names are readable instead of cut off.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-08-02",
    headline: "No more stuck factories",
    notes: [
      "Machines that feed each other in a loop used to talk themselves into doing nothing — both sides waiting on the other, everything sat near 0%.",
      "The planner now solves the whole board at once and starts every machine at full speed, so loops run without a fake starter source.",
      "When a resource is tight it is shared fairly instead of one big machine starving out a small one. Real boards jumped from 58/s to 303/s.",
    ],
  },
];
