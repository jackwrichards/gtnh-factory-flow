# Plan networks

Networks are personal resource ledgers over saved plans. They never change a plan's solve or settings. Create or open
them from the tab strip's + menu or the library's Networks section. Plans keep their normal library collections.

## Accounting

A plan contributes its solved boundary imports and exports, through drawers or directly through machine ports.
Collected products, byproducts and buffer surplus count as supply; trash and internal machine flow are excluded.
Removing a boundary drawer does not remove the machine's solved flow from the network. Importing and exporting
the same resource contributes to both columns. Item and fluid identities stay separate; there is no inferred
conversion or matching by name.

Each plan's I/O button selects network inputs and outputs per machine. All ports count by default. Clear all starts
an explicit selection; Use all ports also includes ports added later. Selections follow stable machine/recipe-section
port ids across drawer removal and network moves. An unavailable selected port marks totals incomplete. Internal
wires contribute no boundary flow, even when selected. Shared buffer surplus and drawer chains have separate Drawers
entries because their net rates cannot be assigned to a single machine port. Power always covers the included plan.
These choices only filter the ledger; they never change recipes, rates, or the solve.

The I/O picker is a modal with the same time-unit dial as the network header: per tick, second, minute or hour.
Machine headings show selected/available port counts and collapse their port lists. The first machine starts open.
The question-mark help control beside X explains boundary accounting without taking space from the port list.
The group dropdown lists this network's groups and Ungrouped, saves on selection, and follows later group moves.
Create groups with the sidebar's folder-plus control. Group, rate and bulk port controls share one wrapping toolbar.
Changes save immediately; X, Escape or clicking the backdrop closes it.
Counts follow explicit selections, Clear all and Use all ports; collapsing never changes membership or totals.
The header and I/O picker share the app's rate-unit dial and never recalculate the solve. The picker's Plan group
field assigns a plan to a named, collapsible list group, or clears it back to Ungrouped. Groups organize members only, have no resource-sharing
rules, and travel with a plan on a network move. Use the plus beside Plans to add members and the plus beside
Networks to create a subnetwork of the open network. The refresh icon retries figures and sync.
Scroll up over the time-unit or Sharing selector to advance its value; scroll down to go back. Values stop at
the ends. These controls follow the device's scroll-to-change-values preference and consume scrolling only when enabled.
Drag a plan row onto a group to move it, even when the group is collapsed. Empty Ungrouped appears as a drop target
while dragging. The I/O group field is also available for keyboard and touch use. Group moves keep inclusion and port choices.
The folder-plus beside the Plans heading creates an empty named drop target. Empty groups persist; their options
menu renames the group and all its members, or deletes the group and returns its plans to Ungrouped. Plans use
compact single-line rows, with full names on hover. Their options menu contains I/O and Remove from network;
an I/O shortcut appears on hover and keyboard focus, or stays visible on touch screens. Add plans opens a modal
with search and existing membership shown.
Drag the sidebar divider to give plan names more space; arrow keys resize it and double-click restores its default.
The width stays on this device. Compact screens stack the list below the ledger. The ledger scrolls independently,
keeping its headings at the top and resource names on the left. Sharing choices keep short labels with tooltips
that explain their direction across the parent boundary.
Resource filters show All rows, Shortages with unmet or unallocated demand, Available with positive local surplus,
and, for subnets, Parent connections with a nonzero requested import or offered export. Available in a subnet
precedes consumption elsewhere in its parent. Covered parent imports are not counted as shortages; unallocated
parent shortages are. The shortage count opens the Shortages view. Searches
and filters with no matches explain why no rows are shown. The resource-name button fills its entire cell.
Parent and power settings are under Network settings; root networks have no Include in parent totals checkbox.
Both pickers use their X close control.
The header reports local writes, pending cloud synchronization, active sync and updating figures without pop-up messages.
Right-click a network tab for Rename, New subnetwork, Close tab or Delete network. Shift+F10 opens the same menu.
The header's trash icon also asks for confirmation, explaining that plans stay and subnetworks move to the deleted
network's parent. Deleting a subnet opens its parent; deleting a root returns to Networks. A failed deletion save
keeps the network open.

At each network, supply minus demand gives free resources or a shortage. These are configured rates, not measured
inventories or a promise that supplying lines can operate without their own missing inputs. Power generation and
usage use the same average figures as the plan overview and sum included descendants once.
Subnetworks call their free balance Local surplus: it precedes consumption elsewhere in the parent. From parent
is a requested import and To parent is offered supply, not a reservation of resources.
Mark a subnet Self-powered to keep both its power usage and generation out of parent totals. Its own power figures
stay visible, and its resource sharing is unchanged. This is an explicit separate-supply choice, not a calculated
claim that its generators meet demand. The choice persists and syncs with the network.
A lightning bolt beside the subnet name and its power summary identifies this separate supply.

Subnetworks balance locally first. Internal (the default) exposes nothing; Import exposes residual demand; Export
exposes residual supply; Both exposes either. Every ancestor boundary needs its own permission. Parent totals only see
these boundary rates, never the child's gross internal production. From parent is a request. When a parent is short,
the view flags that resource without allocating available supply among competing plans or subnetworks.

Each plan has one direct membership across the account hierarchy. Moving replaces its old membership. Inclusion
can be disabled without removing members. Deleting a network releases its plans and promotes its children, keeping
their sharing settings. Shared references include owner and design ids; losing access leaves an unavailable member
and incomplete totals. Deleting an owned plan removes its membership. Task boards do not contribute.

## Storage and calculations

`src/lib/networks/model.ts` owns topology validation and aggregation. The catalogue is separate from FactoryProject,
so ordinary exports, links and live operations remain unchanged. The `gtnh-plan-networks` IndexedDB database stores
account catalogues and conflict recovery copies. Browser-tab writes compare a token in one read/write transaction.
Networks are personal: sharing or exporting a member plan does not share its hierarchy, groups, sharing rules or
port selections. Existing mod versions can keep exchanging and editing individual plans without an update, but
do not display or edit website networks. Networks are not part of plan files, plan links or mod transfers.
There is no network export/import control. Signed-out networks and conflict recovery copies live only in this
browser's storage; clearing it removes those copies. Signed-in catalogues sync separately to the account.

Authenticated GET/PUT `/api/library/networks` saves the whole topology under an account revision. PUT compares that
revision atomically, including creation races. Empty catalogues remain revisioned so an old device cannot resurrect a
deletion. Rejected writes retain the local candidate until the player chooses a version. Keep my changes selects
the complete local account catalogue; Use saved networks selects the complete saved catalogue. Separate edits
are not merged. Recovery copies stay in the same browser database and are not an independent backup.
Calculated results do not sync.

Apply `supabase/migrations/2026-10-19-plan-networks.sql` to new and existing server databases before enabling network sync.
`npm run dev:local` (`LOCAL_DB=1`) loads migrations automatically. Ordinary `npm run dev` against Supabase does not.
Networks work locally while signed out; signing in adopts this browser's initial catalogue
when that account has no local catalogue yet. A conflicting existing remote catalogue requires a choice.

Closed members are normalized and have recipes restored through the same pure helper as the canvas. They solve in a
separate sequential worker queue and never land on the canvas or write back to saved plans. A bounded content cache
includes plan contents and dataset dependencies. Current canvas results can be reused. Missing data and failed or
outdated results are explicit; partial totals are marked incomplete. Display dials only reformat figures.
Complete game-exported recipe bodies and generated cell-wire tank recipes remain usable when the dataset has no
match. Dataset recipes still require restoration so a missing runtime table cannot silently change their figures.

Tests: `src/lib/networks/*.test.ts`, `src/app/api/library/networks/route.test.ts`, and tab/library tests. Real-app checks
cover closed members, contribution rows, toggles, moves, parent sharing, reload, account sync and compact layout.
