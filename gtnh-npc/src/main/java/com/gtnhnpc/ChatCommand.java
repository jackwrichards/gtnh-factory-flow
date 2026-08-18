package com.gtnhnpc;

import net.minecraft.command.CommandBase;
import net.minecraft.command.CommandException;
import net.minecraft.command.ICommandSender;
import net.minecraft.entity.player.EntityPlayer;

import java.util.Arrays;
import java.util.List;

/**
 * /gtnhnpc &lt;task...&gt; — give the NPC a task in plain language.
 *
 * The rest of the command line is joined back into one sentence and handed to the
 * agent. The agent does all the thinking; this just forwards the words and the
 * asking player.
 */
public class ChatCommand extends CommandBase {

    private final NpcController controller;

    public ChatCommand(NpcController controller) {
        this.controller = controller;
    }

    @Override
    public String getCommandName() {
        return "gtnhnpc";
    }

    @Override
    public String getCommandUsage(ICommandSender sender) {
        return "/gtnhnpc <task to give the NPC>";
    }

    @Override
    public int getRequiredPermissionLevel() {
        // Anyone can task the NPC on your server; tighten if you want it admin-only.
        return 0;
    }

    @Override
    public void processCommand(ICommandSender sender, String[] args) throws CommandException {
        if (!(sender instanceof EntityPlayer)) {
            throw new CommandException("Only a player can task the NPC.");
        }
        if (args.length == 0) {
            sender.sendMessage("Usage: " + getCommandUsage(sender));
            return;
        }
        String task = joinWords(args, 0);
        controller.submitTask(task, (EntityPlayer) sender);
        sender.sendMessage("Thinking...");
    }

    @Override
    public List<String> addTabCompletionOptions(ICommandSender sender, String[] args, int x, int y, int z) {
        return null;
    }

    @Override
    public boolean canCommandSenderUseCommand(ICommandSender sender) {
        return true;
    }

    // Keep the default (a full line) so "gopher, build me a furnace" reads as one task.
    @SuppressWarnings("unused")
    private static String joinWords(String[] args, int from) {
        return String.join(" ", Arrays.asList(args).subList(from, args.length));
    }
}
