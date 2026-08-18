package com.gtnhnpc;

import com.gtnhnpc.AgentTypes.InvItem;
import com.gtnhnpc.AgentTypes.Vec3;
import com.gtnhnpc.AgentTypes.WorldState;
import net.minecraft.entity.player.EntityPlayer;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;

import java.util.ArrayList;

/**
 * The mod's "eyes": gather the slice of the world the agent plans against.
 *
 * v0 covers what's cheap and dependency-free — the player's position and the items
 * they are carrying. The one gap, deliberately left as a seam: the list of nearby
 * GregTech machines and their contents. Reading that requires the GT TileEntity
 * API, so it is isolated here with a clear TODO rather than guessed.
 */
public final class WorldStateCollector {

    private WorldStateCollector() {}

    public static WorldState collect(EntityPlayer player) {
        WorldState ws = new WorldState();
        ws.inventory = new ArrayList<>();
        ws.machines = new ArrayList<>();

        if (player == null) {
            ws.playerId = "unknown";
            ws.playerAt = new Vec3(0, 0, 0);
            return ws;
        }

        ws.playerId = player.getCommandSenderName();
        ws.playerAt = new Vec3(player.posX, player.posY, player.posZ);

        ItemStack[] inv = player.inventory.mainInventory;
        for (ItemStack s : inv) {
            if (s == null || s.getItem() == null) continue;
            InvItem it = new InvItem();
            it.id = itemId(s);
            it.kind = "item";
            it.amount = s.stackSize;
            it.name = s.getDisplayName();
            ws.inventory.add(it);
        }

        // TODO(1.7.10): scan a radius around the player for GT machines and fill
        // ws.machines with each's id, machineType, position, and (if running)
        // progress/eut. This is what the agent's analyze_factory feeds on.
        return ws;
    }

    /** The registry id of a stack, with a ":meta" suffix when it is not 0. */
    private static String itemId(ItemStack s) {
        Item item = s.getItem();
        String id = Item.itemRegistry.getNameForObject(item);
        if (s.getItemDamage() != 0) id = id + ":" + s.getItemDamage();
        return id;
    }
}
