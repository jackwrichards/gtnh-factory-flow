package com.gtnhnpc;

import com.gtnhnpc.AgentTypes.ActionResult;
import com.gtnhnpc.AgentTypes.ResourceRef;
import com.gtnhnpc.AgentTypes.Vec3;
import net.minecraft.world.World;

/**
 * The GT-specific machine actions, isolated behind an interface.
 *
 * Inserting into a machine, starting a recipe, and pulling outputs all require
 * the GregTech TileEntity API (the machine's inventory, its input/output slots,
 * its "start" signal). That is the genuinely GT-version-specific seam of the
 * whole mod, so it lives behind this interface rather than scattered through the
 * executor. A real 1.7.10 implementation reads the machine's TileEntity at
 * {@code machine} and drives it; the {@link NoopMachineOperator} below is the
 * honest stand-in until that's written, and it says so.
 */
public interface MachineOperator {

    /** Put {@code amount} of {@code item} into the machine's input slot. */
    ActionResult insert(Vec3 machine, ResourceRef item, int amount, int slot, World world);

    /** Start the machine's current recipe. */
    ActionResult run(Vec3 machine, World world);

    /** Pull the machine's output(s) into the world / a hopper. */
    ActionResult collect(Vec3 machine, int slot, World world);

    /**
     * No-op stand-in: reports each machine action as not yet implemented for
     * 1.7.10. Swapped for a real GT TileEntity driver in a later phase.
     */
    final class NoopMachineOperator implements MachineOperator {
        @Override
        public ActionResult insert(Vec3 machine, ResourceRef item, int amount, int slot, World world) {
            return fail("insert is not wired to GregTech yet (TODO 1.7.10: drive the machine's TileEntity)");
        }

        @Override
        public ActionResult run(Vec3 machine, World world) {
            return fail("run is not wired to GregTech yet (TODO 1.7.10: start the recipe)");
        }

        @Override
        public ActionResult collect(Vec3 machine, int slot, World world) {
            return fail("collect is not wired to GregTech yet (TODO 1.7.10: pull the outputs)");
        }

        private static ActionResult fail(String msg) {
            ActionResult r = new ActionResult();
            r.ok = false;
            r.message = msg;
            return r;
        }
    }
}
