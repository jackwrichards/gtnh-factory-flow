package com.gtnhnpc;

import com.gtnhnpc.AgentTypes.Action;
import com.gtnhnpc.AgentTypes.ActionResult;
import com.gtnhnpc.AgentTypes.TaskRequest;
import com.gtnhnpc.AgentTypes.TaskResponse;
import com.gtnhnpc.AgentTypes.WorldState;
import net.minecraft.entity.player.EntityPlayer;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.World;
import net.minecraftforge.fml.common.event.FMLServerStartingEvent;
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent;
import net.minecraftforge.fml.common.gameevent.TickEvent;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The one stateful object: owns the NPC, the current plan (and its index), and
 * the bridge client to the agent.
 *
 * Threading model: the agent (a local 27B LLM) is SLOW, so the HTTP round-trip
 * happens on a single worker thread. The result is hopped back onto the main
 * server thread via {@code addScheduledTask}; the tick loop then advances the
 * plan one action per tick. The tick loop is the only thing that touches the
 * world or the NPC, so no world access is off-thread.
 */
public class NpcController {

    // Where the agent is listening. Move to a real FML config (cfg file) later.
    static final String AGENT_BASE_URL = "http://127.0.0.1:8787";
    // The memory key the agent keys on. Wire to the actual save name later.
    static final String WORLD_NAME = "default";
    // Where the NPC first appears. Wire to the world spawn / the base later.
    static final double[] HOME = { 0, 64, 0 };

    private final ActionExecutor executor;
    private final AgentBridgeClient bridge;
    private final ExecutorService httpPool = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "gtnhnpc-agent");
        t.setDaemon(true);
        return t;
    });

    private NpcEntity npc;
    private Action[] actions;
    private int actionIndex;
    private int waitTicks;
    private EntityPlayer taskPlayer;

    public NpcController() {
        this(new ActionExecutor(new MachineOperator.NoopMachineOperator()), new AgentBridgeClient(AGENT_BASE_URL));
    }

    NpcController(ActionExecutor executor, AgentBridgeClient bridge) {
        this.executor = executor;
        this.bridge = bridge;
    }

    @SubscribeEvent
    public void onServerStarting(FMLServerStartingEvent event) {
        event.registerServerCommand(new ChatCommand(this));
    }

    @SubscribeEvent
    public void onTick(TickEvent event) {
        // Only the server/world tick, on the way in.
        if (event.type != TickEvent.Type.World || event.phase != TickEvent.Phase.START) return;
        MinecraftServer server = MinecraftServer.getServer();
        if (server == null) return;
        World world = server.getDefaultWorld();
        if (world == null) return;

        if (npc == null) spawnNpc(world);
        advance(world);
    }

    private void spawnNpc(World world) {
        npc = new NpcEntity(world);
        npc.setPosition(HOME[0], HOME[1], HOME[2]);
        world.spawnEntityInWorld(npc);
        // TODO(1.7.10): spawn at the world spawn or the task-giver's base, not HOME.
    }

    /**
     * Called (on the main thread) by {@link ChatCommand} when a player gives a task.
     * Collects world state and fires the agent off on the worker thread.
     */
    public void submitTask(String task, EntityPlayer player) {
        this.taskPlayer = player;
        TaskRequest req = new TaskRequest();
        req.task = task;
        req.worldName = WORLD_NAME;
        req.playerId = player == null ? null : player.getCommandSenderName();
        req.worldState = WorldStateCollector.collect(player);

        httpPool.submit(() -> {
            final TaskResponse resp;
            final Exception err;
            try {
                resp = bridge.postTask(req);
                err = null;
            } catch (Exception e) {
                resp = null;
                err = e;
            }
            MinecraftServer.getServer().addScheduledTask(() -> onAgentResponse(resp, err));
        });
    }

    private void onAgentResponse(TaskResponse resp, Exception err) {
        if (err != null) {
            tell(NpcEntity.DEFAULT_NAME + ": I could not reach my brain (" + err.getMessage() + ").");
            return;
        }
        if (resp.plan != null && resp.plan.reply != null && !resp.plan.reply.isEmpty()) {
            tell(NpcEntity.DEFAULT_NAME + ": " + resp.plan.reply);
        }
        // Answer-only tasks carry no actions — nothing to run.
        if (resp.plan == null || resp.plan.actions == null) return;
        actions = resp.plan.actions.toArray(new Action[0]);
        actionIndex = 0;
        waitTicks = 0;
    }

    /** One tick: advance the current plan action (if any) by one step. */
    private void advance(World world) {
        if (actions == null || actionIndex >= actions.length) return;
        Action a = actions[actionIndex];
        if (a == null || a.type == null) {
            advanceIndex();
            return;
        }

        switch (a.type) {
            case "wait": {
                if (waitTicks <= 0) waitTicks = Math.max(1, a.ticks);
                waitTicks--;
                if (waitTicks <= 0) advanceIndex();
                break;
            }
            case "goto": {
                if (a.at != null) npc.moveTo(a.at.x, a.at.y, a.at.z);
                // v0: teleport is instant, so we are "arrived" this tick.
                // TODO(1.7.10): pathfind and only advance on arrival.
                advanceIndex();
                break;
            }
            case "say": {
                tell(NpcEntity.DEFAULT_NAME + ": " + (a.text == null ? "" : a.text));
                advanceIndex();
                break;
            }
            case "place":
            case "mine":
            case "insert":
            case "run":
            case "collect":
            case "pickup": {
                ActionResult r = executor.execute(a, npc, world);
                if (!r.ok) tell(NpcEntity.DEFAULT_NAME + ": " + r.message);
                advanceIndex();
                break;
            }
            default:
                advanceIndex();
        }
    }

    private void advanceIndex() {
        actionIndex++;
        waitTicks = 0;
        if (actions != null && actionIndex >= actions.length) actions = null;
    }

    private void tell(String msg) {
        if (taskPlayer != null) taskPlayer.sendMessage(msg);
    }
}
