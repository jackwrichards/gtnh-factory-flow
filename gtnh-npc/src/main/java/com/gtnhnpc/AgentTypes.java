package com.gtnhnpc;

import java.util.List;

/**
 * The JSON shapes that cross the HTTP bridge between this mod and the gtnh-agent.
 *
 * These are deliberately plain POJOs with field names that EXACTLY match the
 * camelCase the Node agent emits (see src/agent/types.ts and bridge.ts), so Gson
 * can (de)serialize them with no adapters. The agent's `Action` is a discriminated
 * union on `type`; we model it as ONE flat class carrying every optional field and
 * switch on {@code type} at the use site — simpler and more robust than a Gson
 * type adapter for a nine-variant union in a 1.7.10 mod.
 */
public final class AgentTypes {

    private AgentTypes() {}

    /** A point in the world. Doubles for "where the player is" and action targets. */
    public static class Vec3 {
        public double x;
        public double y;
        public double z;

        public Vec3() {}

        public Vec3(double x, double y, double z) {
            this.x = x;
            this.y = y;
            this.z = z;
        }
    }

    /** A reference to a GTNH resource, by the id the agent's dataset uses. */
    public static class ResourceRef {
        public String kind; // "item" | "fluid" | "aspect"
        public String id;
        public String name;
    }

    /** One item the player is carrying, as the mod sees it. */
    public static class InvItem {
        public String id;
        public String kind; // "item" | "fluid" | "aspect"
        public int amount;
        public String name;
    }

    /** A machine the mod can see near the NPC. */
    public static class MachineState {
        public String id;
        public String machineType;
        public Vec3 at;
        public Integer progressTicks;
        public Double eut;
        public String note;
    }

    /** What the mod reports about the world, sent with every task. */
    public static class WorldState {
        public String playerId;
        public Vec3 playerAt;
        public List<InvItem> inventory;
        public List<MachineState> machines;
        public String note;
    }

    /**
     * One action the agent plans. Flat on purpose: each variant uses a subset of
     * these fields, and the executor switches on {@code type} to read the ones it
     * needs. Fields default to 0 / null when the variant does not carry them.
     */
    public static class Action {
        public String type;      // goto | place | mine | insert | run | collect | pickup | say | wait
        public Vec3 at;          // goto / place / mine / pickup
        public ResourceRef item; // place / insert
        public Vec3 machine;     // insert / run / collect
        public int amount;       // insert
        public int slot;         // insert / collect (default 0)
        public int facing;       // place (default 0)
        public String text;      // say
        public int ticks;        // wait
    }

    /** What the mod reports after one action ran. */
    public static class ActionResult {
        public boolean ok;
        public String message;
    }

    /** The structured answer the agent's LLM ends with. */
    public static class Plan {
        public String reply;
        public List<Action> actions;
        public List<ResourceRef> needs;
        public String notes;
    }

    /** What this mod POSTs to the agent. */
    public static class TaskRequest {
        public String task;
        public String worldName;
        public String playerId;
        public WorldState worldState;
    }

    /** What the agent POSTs back. */
    public static class TaskResponse {
        public Plan plan;
        public List<ActionResult> results;
        public WorldState worldState;
        public int steps;
        public Usage usage;
    }

    /** Token usage, when the endpoint reports it. */
    public static class Usage {
        public int promptTokens;
        public int completionTokens;
    }
}
