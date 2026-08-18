package com.gtnhnpc;

import com.gtnhnpc.AgentTypes.Action;
import com.gtnhnpc.AgentTypes.ActionResult;
import com.gtnhnpc.AgentTypes.ResourceRef;
import com.gtnhnpc.AgentTypes.Vec3;
import net.minecraft.block.Block;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.world.World;

/**
 * Carries out the world actions the agent plans. Split by ownership:
 *
 *   - say / goto / wait are handled by {@link NpcController} (they need the
 *     task's player, the body, or timing).
 *   - place / mine / pickup are GENERIC world actions, done here with vanilla
 *     {@link World} + the item registry.
 *   - insert / run / collect are GT-specific and delegate to the
 *     {@link MachineOperator}.
 *
 * The honest v0 limit: the agent names resources by its DATASET ids
 * (e.g. "gregtech:..." or "item:spruce_log"), which do not always match Minecraft's
 * item-registry names. {@link #resolveItem} tries its best and, when it cannot
 * map an id, reports it rather than inventing a block. That id-mapping is a later
 * phase (it should key off the same dataset the agent uses).
 */
public class ActionExecutor {

    private final MachineOperator machines;

    public ActionExecutor(MachineOperator machines) {
        this.machines = machines;
    }

    public ActionResult execute(Action a, NpcEntity npc, World world) {
        if (a.type == null) return fail("action has no type");
        switch (a.type) {
            case "place":   return place(a, world);
            case "mine":    return mine(a, world);
            case "pickup":  return pickup(a);
            case "insert":  return machines.insert(a.machine, a.item, a.amount, a.slot, world);
            case "run":     return machines.run(a.machine, world);
            case "collect": return machines.collect(a.machine, a.slot, world);
            default:        return fail("unknown action type: " + a.type);
        }
    }

    private ActionResult place(Action a, World world) {
        if (a.at == null) return fail("place needs a position");
        ItemStack stack = resolveItem(a.item);
        if (stack == null) {
            return fail("cannot map '" + id(a.item) + "' to a placeable block (TODO 1.7.10: map dataset item ids to MC item ids)");
        }
        int x = (int) a.at.x, y = (int) a.at.y, z = (int) a.at.z;
        if (!world.isAir(x, y, z)) {
            return fail("position " + pos(a.at) + " is not air; cannot place " + stack.getDisplayName());
        }
        // Metadata 0, notify=2 (force, no sound). Facing/TE orientation is GT-specific.
        world.setBlock(x, y, z, stack.getItem(), 0, 2);
        return ok("placed " + stack.getDisplayName() + " at " + pos(a.at));
    }

    private ActionResult mine(Action a, World world) {
        if (a.at == null) return fail("mine needs a position");
        int x = (int) a.at.x, y = (int) a.at.y, z = (int) a.at.z;
        Block block = world.getBlock(x, y, z);
        if (block == null) return fail("nothing to mine at " + pos(a.at));
        world.setBlockToAir(x, y, z);
        return ok("broke " + block.getUnlocalizedName() + " at " + pos(a.at) + " (v0: no tool/drop handling)");
    }

    private ActionResult pickup(Action a) {
        return fail("pickup is not wired for 1.7.10 yet (TODO: pull ground items into the NPC's inventory)");
    }

    // ---- helpers ----------------------------------------------------------

    private static String id(ResourceRef ref) {
        return ref == null ? "null" : ref.id;
    }

    private static String pos(Vec3 v) {
        return (int) v.x + "," + (int) v.y + "," + (int) v.z;
    }

    /**
     * Best-effort: turn a dataset id ("id" or "id:meta") into a Minecraft
     * {@link ItemStack}. Returns null when it cannot map the id — the caller then
     * reports the gap instead of guessing.
     */
    private static ItemStack resolveItem(ResourceRef ref) {
        if (ref == null || ref.id == null || ref.id.isEmpty()) return null;
        String id = ref.id;
        int meta = 0;
        int colon = id.lastIndexOf(':');
        if (colon > 0) {
            String tail = id.substring(colon + 1);
            if (isAllDigits(tail)) {
                meta = Integer.parseInt(tail);
                id = id.substring(0, colon);
            }
        }
        Item item = Item.itemRegistry.getObject(id);
        if (item == null) return null;
        return new ItemStack(item, 1, meta);
    }

    private static boolean isAllDigits(String s) {
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) < '0' || s.charAt(i) > '9') return false;
        }
        return !s.isEmpty();
    }

    private static ActionResult ok(String msg) {
        ActionResult r = new ActionResult();
        r.ok = true;
        r.message = msg;
        return r;
    }

    private static ActionResult fail(String msg) {
        ActionResult r = new ActionResult();
        r.ok = false;
        r.message = msg;
        return r;
    }
}
