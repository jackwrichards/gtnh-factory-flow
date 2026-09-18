# Pool production groups

Production groups are material-balancing boundaries in Pool mode. They are independent of canvas boards and shared physical machines. Every recipe section of a shared machine stays in its owner's production group.

## Using groups

Choose **New group** in the Factory pool heading. Assign machines and products with their group selectors. A group's **Subgroup** button creates a nested group; its parent selector moves the whole group. **Ungroup** removes only the container, moving its machines, products and immediate subgroups to its parent. These edits support undo.

Open **Materials** to inspect that scope's actual makes, takes and net flow and select a rule per material:

| Rule | Meaning |
| --- | --- |
| Auto | If this group both makes and uses the material, balance it here. Otherwise pass its ports to the parent. At the factory, materials with no producer import automatically. |
| Share with parent | Pass both production and consumption to the parent instead of matching them here. The parent can still balance them locally. |
| Outside supply | Permit unlimited external supply directly at this scope, even if a producer exists. |

Children resolve before parents. A parent rule cannot reach into a material already kept local by a child. Share at every intervening group if the material needs to reach the factory pool. Groups are useful with Auto alone: they keep independent production lines from borrowing each other's intermediates.

For example, an ingot maker and plate bender in one group keep their ingots together. A lathe outside that group imports its own ingots. Sharing ingots with the parent lets the maker supply both machines. Allowing outside supply instead lets the group buy ingots directly.

Outside supply is permission, not a promise to use only a shortfall. Pool first minimizes required machinery, so it may idle an unpinned producer and import the material. Pin a machine count when that producer must keep running. This separates the reference calculator's child Ignore (share upward) and root Ignore (external supply) into two explicit controls.

## Surplus and targets

Surplus is still allowed automatically. Local surplus stays in that group's pool; it does not silently satisfy another group's demand. Share the material to make it available to the parent. A product assigned inside a group can request additional intermediate output without exposing that intermediate to the parent. Identical product resources in different groups have independent targets.

Negative products remain outside this change. No recipe editing, new machine math, electricity imports, or Build/wired Solve balancing changes are introduced.

## Saved data and implementation

Optional project fields productionGroups and poolResourceRules hold the hierarchy and policies. Nodes and storages use productionGroupId. Optional fields preserve compatibility with older plans. Import normalization repairs missing/cyclic parents and dangling memberships. Copy/paste includes selected members' group ancestors and remaps their IDs. Collapse state is a per-plan local workspace preference.

The solver expands shared machines first, then builds resource pools from deepest group to factory. Local pools, explicit outside sources and cell/fluid conversion helpers are private to their scope. Existing LP conservation, target constraints and surplus accounting run over that expanded graph. Saved wires and recipes are unchanged.

Regression coverage lives in production-groups.test.ts under solver and store, plus PoolWorksheet.test.tsx. It covers nested sharing, outside supply and pins, independent product targets, surplus, cells, shared machines, JSON, invalid hierarchies, undo, clipboard remapping, and read-only inspection.
