package com.gtnhnpc;

import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.common.event.FMLPreInitializationEvent;

/**
 * Entry point for the GTNH NPC. This mod is SERVER-SIDE ONLY: it holds a visible
 * vanilla mob, reads local state, and carries out the ordered actions the
 * gtnh-agent returns over HTTP. It has no intelligence of its own — all the GTNH
 * knowledge and planning lives in the Node agent.
 *
 * 1.7.10 has no {@code @EventBusSubscriber}; we register the controller on the
 * mod event bus in {@code preInit}.
 */
@Mod(modid = GtnhNpcMod.MODID,
        name = "GTNH NPC",
        version = "0.1.0",
        acceptedMinecraftVersions = "[1.7.10]",
        clientSideOnly = false)
public class GtnhNpcMod {

    public static final String MODID = "gtnhnpc";

    /** The single controller: owns the NPC, the current plan, and the bridge client. */
    public static NpcController controller;

    public GtnhNpcMod() {
        controller = new NpcController();
    }

    @Mod.EventHandler
    public void preInit(FMLPreInitializationEvent event) {
        // The controller's @SubscribeEvent handlers (tick + server starting) bind here.
        event.modEventBus.register(controller);
    }

    @Mod.EventHandler
    @SubscribeEvent
    public void onServerStarting() {
        // Marker so the mod is discoverable; real work happens in NpcController.
    }
}
