package com.gtnhnpc;

import net.minecraft.entity.EntityAgeable;
import net.minecraft.entity.passive.EntityVillager;
import net.minecraft.world.World;

/**
 * The NPC's visible body: a vanilla 1.7.10 villager.
 *
 * The mod is server-side ONLY, so the body must be a vanilla entity the client
 * already renders — no client code needed. We name it, give it a persistent name
 * tag, and turn OFF its own AI so it stands still until the controller moves it
 * (a wandering villager would fight our pathfinding/teleport). This is the whole
 * "presence" — swap this class for a tamed wolf/parrot later without touching
 * anything else, since the rest of the mod only talks to it through
 * {@link #moveTo(double, double, double)}.
 *
 * Chat ("say") is handled by {@link NpcController}, which knows the task's player.
 */
public class NpcEntity extends EntityVillager {

    public static final String DEFAULT_NAME = "Gopher";

    public NpcEntity(World world) {
        super(world);
        setCustomNameTag(DEFAULT_NAME);
        setAlwaysShowNameTag(true);
        // Stand still until told: no wandering, no breeding, no own goals.
        setNoAi(true);
        setPersistent();
    }

    /**
     * Move the body. v0: a teleport — reliable, and fine for a skeleton. A later
     * phase replaces this with a real pathfind (the entity visibly walks there).
     */
    public void moveTo(double x, double y, double z) {
        setPositionAndRotation(x, y, z, 0f, 0f);
    }

    /** Silence the villager's ambient grunts so it reads as a quiet worker. */
    @Override
    public boolean isSilent() {
        return true;
    }

    @Override
    public EntityAgeable createChild(World world) {
        return null; // no breeding
    }
}
