# Pool production groups

Pool follows the reference calculator's organization: a global **Desired rates** list, the **All production summary**, and nested production groups. Each group shows its power, inputs, outputs, and material-sharing controls. The separate Resources summary and hidden Materials panel are gone.

## Using groups

Choose **Add group** in All production or an existing group. Move a machine with its grip onto a group heading, including an empty or collapsed group. Drop it onto All production to move it back outside all subgroups. Empty groups have no collapse arrow until there is content to hide. A group has its own grip for moving the whole group; moving a parent into its descendants is rejected. The settings button at the right of each machine expands an inline Machine settings row when controls exist; otherwise Settings is disabled. The Inside selector appears only when a group has a different valid parent to choose.

Group outlines show the hierarchy. Collapse hides the group's machines and nested groups while retaining its totals and material rules. Ctrl+F opens the normally hidden worksheet search, which temporarily reveals collapsed machines; Escape clears and closes it. Delete group (the trash icon) removes only the container; machines, products and child groups move to the parent. Edits support undo.

## Compact worksheet

Recipes use a compact row with bare item icons and rates. Names and full port details remain in tooltips; click/right-click still browse recipes/uses. Tier and machine count stay inline. Click the machine icon to choose a different machine; its swap mark indicates the action. Column labels sit below each populated group heading, with subtle dividers and full status reasons. The buttons on the right duplicate, replace, remove, and open machine settings; the labeled Settings button expands those controls directly beneath the machine, with Escape or the close button to fold them back up. Shared machines keep one row per recipe, with each recipe's own removal button.

Desired rates uses a narrower table beside a permanent Total power breakdown. All production combines every group; Top level in the selectors refers to recipes outside named subgroups. Group power is a compact headline. Click it (or press Enter while focused) for average, peak, generation, net, and steam totals; Escape closes it. Compact, always-visible material tables group Inputs, Outputs, and Internal materials. Each material occupies one line with its icon, signed rate, and compact Auto/supply/sharing selector; additional columns use the available horizontal space. Units use the same muted accent color as other rate displays. Nonzero item/fluid rates below 0.00001 in the selected time unit display as <.00001; power keeps its existing 0.01 threshold and displays <.01. These are display limits only; editing a tiny target retains its actual value. Negative red rates mean net input, positive green rates mean net output, and gray zero means no net flow (including idle materials). Hover the rate to see both gross input and output. The tables sit side by side when space permits, render 24 entries per page, and cap their combined height. Large lists show a search across all materials and page controls. Child-local totals without a matching material row in the parent say Within groups; their rule stays in the child. Empty groups show a single heading with a drop hint. Recipes with many ingredients wrap only their own rows. Narrower worksheets first collapse status text to an indicator and actions to icons, preserving table rows and per-group column headings. Status details open on hover or focus. Below 700 CSS pixels, controls and materials use two lines; phones below 440 pixels get a separate power/actions line. Shared recipes keep their own status, circuit, materials, and removal controls.

## Material rules (the reference's Ignore)

Pool imports missing inputs automatically; no rules need enabling for ordinary plans. Supply and sharing selectors sit directly beside each material in the group header; nothing needs opening to see the current rule. Each material defaults to **Auto**: at the root, use its producer if one exists, otherwise import it. **Import anyway** permits imports even when a producer exists and may idle that producer. Inside groups, **Share with parent** bypasses local balancing. There is no general **never import** or explicit **keep inside** rule. Auto retains a material locally only when the group both makes and uses it; one-sided materials reach the parent. These are the same balancing rules the reference calls Ignore:

| Scope | Matching normally | Ignore |
| --- | --- | --- |
| Production group | Materials both made and consumed here balance locally. One-sided resources reach the parent. | Both sides reach the parent, which can match them with other machines. |
| Factory | Materials with producers balance; materials nobody produces import automatically. | Permit imports even when a producer exists. |

Children resolve first. Ignoring a material in the parent cannot change a match already kept inside a child. Ignore it at each intervening group if it needs to reach Factory. Materials with saved rules remain in the strip even if their machines move elsewhere, so the setting can be cleared.

Factory Ignore is permission to import, not a promise to use only a shortfall. Pool minimizes machinery first, so an unpinned producer may idle. Pin its count if it must run.

## Targets, totals and surplus

Desired rates are global requests, like the reference. Group inputs and outputs are calculated results, not extra targets. Inputs and outputs remain visible without opening a Materials panel. Parent totals include closed child surpluses and direct imports; shared ports are counted once.

Existing plans from the earlier group interface retain scoped targets and direct outside-supply policies. A scoped target is labeled in Desired rates and has a **Make global** action. A saved direct-supply rule inside a group is explicitly labeled **Outside supply**. New sharing overrides inside groups always use parent sharing.

Surplus remains allowed automatically. Local surplus stays in that group's pool and appears in totals; it does not silently satisfy another group's demand. Ignore the local match to make that material available to the parent.

Desired rates lists both source and product drawers. The Target (±) column accepts positive output goals and negative input goals. For example, −100/s of ore with Exactly sizes the line to consume 100 ore per second of fresh input; recycled ore is additional circulation, not fresh supply. Actual uses the same sign. Outputs offer At least / Exactly / Ignore. Inputs also offer At most, which caps fresh supply and allows unused supply; a cap alone does not request production. Exactly allows zero and fixes the rate. In Pool an exact output also prevents surplus banking in its receiving pool. Ignore retains the rate without enforcing it; an ignored source remains available. A finite input limit cannot be bypassed by automatic outside supply in its receiving pool.

The rate and rule belong to the drawer and apply in both wired Solve and Pool. Source amounts are positive magnitudes on the board and negative in Pool. Build preserves them without enforcing them. Mode changes preserve all wires; a setup created in Pool still needs wires to run on the board. Targets and rules survive saves, JSON, clipboard, and undo. Legacy poolTargetMode values remain readable. Impossible or conflicting targets are reported. Group scopes apply only in Pool.

## Saved data and implementation

Production groups are independent of canvas boards and physical shared machines. All recipe sections of a shared machine inherit their owner's group. Optional project fields productionGroups and poolResourceRules hold the hierarchy and policies; nodes and storages carry productionGroupId. Imports repair invalid hierarchies and memberships. Clipboard copying carries ancestor groups and remaps their IDs. Collapse state is local workspace preference.

The solver expands shared machines first, then resource scopes deepest-first. Internal share rules implement child Ignore; root import rules implement Factory Ignore. Existing conservation, target and surplus accounting run over the expanded graph. Cell/fluid helpers remain scoped. Saved wires, recipe data and Build/wired Solve behavior are unchanged.

Regression coverage includes the solver/store production-groups.test.ts files, PoolWorksheet.test.tsx, and worksheet-model.test.ts. Browser checks cover real pointer moves into empty/collapsed groups, moving groups, Ignore persistence, and desktop/phone layouts.
