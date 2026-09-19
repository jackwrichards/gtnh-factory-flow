# Pool production groups

Pool follows the reference calculator's organization: a global **Desired products** list, the **All production summary**, and nested production groups. Each group shows its power, inputs, outputs, and internal **Links**. The separate Resources summary and hidden Materials panel are gone.

## Using groups

Choose **Add group** in All production or an existing group. Move a machine with its grip onto a group heading, including an empty or collapsed group. Drop it onto All production to move it back outside all subgroups. Empty groups have no collapse arrow until there is content to hide. A group has its own grip for moving the whole group; moving a parent into its descendants is rejected. The settings button at the right of each machine opens a popover with its labeled Group selector. The Inside selector appears only when a group has a different valid parent to choose.

Group outlines show the hierarchy. Collapse hides the group's machines and nested groups while retaining its totals and Links. Search temporarily reveals collapsed machines. Delete group (the trash icon) removes only the container; machines, products and child groups move to the parent. Edits support undo.

## Compact worksheet

Recipes use a compact row with bare item icons and rates. Names and full port details remain in tooltips; click/right-click still browse recipes/uses. Tier and machine count stay inline. The buttons on the right duplicate, replace, remove, and open machine settings; those settings open in a popover beside the button, dismissed with Escape or a click outside. Shared machines keep one row per recipe, with each recipe's own removal button.

Desired products uses a narrower table beside a permanent Total power breakdown. All production combines every group; Top level in the selectors refers to recipes outside named subgroups. Group power is a compact headline. Click it (or press Enter while focused) for average, peak, generation, net, and steam totals; Escape closes it. Inputs, outputs, and Links share a compact line when they contain materials. Empty groups show a single heading with a drop hint. Recipes with many ingredients wrap only their own rows. Narrow screens stack controls and keep actions on the right.

## Links and Ignore

Click a material in **Links** to toggle **Ignore**, as in ShadowTheAge's calculator:

| Scope | Matching normally | Ignore |
| --- | --- | --- |
| Production group | Materials both made and consumed here balance locally. One-sided resources reach the parent. | Both sides reach the parent, which can match them with other machines. |
| Factory | Materials with producers balance; materials nobody produces import automatically. | Permit imports even when a producer exists. |

Children resolve first. Ignoring a material in the parent cannot change a match already kept inside a child. Ignore it at each intervening group if it needs to reach Factory. Ignored materials remain available in Links even if their machines move elsewhere, so the setting can be cleared.

Factory Ignore is permission to import, not a promise to use only a shortfall. Pool minimizes machinery first, so an unpinned producer may idle. Pin its count if it must run.

## Targets, totals and surplus

Desired products are global requests, like the reference. Group inputs and outputs are calculated results, not extra targets. Inputs and outputs remain visible without opening a Materials panel. Parent totals include closed child surpluses and direct imports; shared ports are counted once.

Existing plans from the earlier group interface retain scoped targets and direct outside-supply policies. A scoped target is labeled in Desired products and has a **Make global** action. A saved direct-supply link is explicitly labeled **Ignore · outside supply**. New Ignore clicks inside groups always use parent sharing.

Surplus remains allowed automatically. Local surplus stays in that group's pool and appears in totals; it does not silently satisfy another group's demand. Ignore the local match to make that material available to the parent. Negative products remain a separate follow-up.

## Saved data and implementation

Production groups are independent of canvas boards and physical shared machines. All recipe sections of a shared machine inherit their owner's group. Optional project fields productionGroups and poolResourceRules hold the hierarchy and policies; nodes and storages carry productionGroupId. Imports repair invalid hierarchies and memberships. Clipboard copying carries ancestor groups and remaps their IDs. Collapse state is local workspace preference.

The solver expands shared machines first, then resource scopes deepest-first. Internal share rules implement child Ignore; root import rules implement Factory Ignore. Existing conservation, target and surplus accounting run over the expanded graph. Cell/fluid helpers remain scoped. Saved wires, recipe data and Build/wired Solve behavior are unchanged.

Regression coverage includes the solver/store production-groups.test.ts files, PoolWorksheet.test.tsx, and worksheet-model.test.ts. Browser checks cover real pointer moves into empty/collapsed groups, moving groups, Ignore persistence, and desktop/phone layouts.
