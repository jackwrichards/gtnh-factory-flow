package dev.gtnhplanner.calcoracle.icons;

import java.awt.image.BufferedImage;
import java.awt.Graphics2D;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

import javax.imageio.ImageIO;

import dev.gtnhplanner.calcoracle.GtnhCalcOracleMod;

import net.minecraft.block.Block;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.FontRenderer;
import net.minecraft.client.gui.GuiScreen;
import net.minecraft.client.renderer.texture.TextureMap;
import net.minecraft.init.Blocks;
import net.minecraft.util.IIcon;
import net.minecraft.client.renderer.OpenGlHelper;
import net.minecraft.client.renderer.RenderHelper;
import net.minecraft.client.renderer.RenderBlocks;
import net.minecraft.client.renderer.Tessellator;
import net.minecraft.client.renderer.entity.RenderItem;
import net.minecraft.client.shader.Framebuffer;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraftforge.client.ForgeHooksClient;
import net.minecraftforge.oredict.OreDictionary;
import org.lwjgl.BufferUtils;
import org.lwjgl.opengl.GL11;
import org.lwjgl.opengl.GL12;
import org.lwjgl.opengl.GL20;

public final class ClientItemStackIconRenderer {

    private static final int ICON_SIZE = Integer.getInteger("gtnh.oracle.iconSize", 256);
    private static final int GUI_ICON_CANVAS_SIZE = 32;
    private static final int GUI_ITEM_SIZE = 16;
    private static final int ICON_EXPORT_BATCH_SIZE = Integer.getInteger("gtnh.oracle.iconExportBatchSize", 64);
    private static final int ICON_PROGRESS_EVERY = Integer.getInteger("gtnh.oracle.iconProgressEvery", 256);
    private static final int MAX_RENDER_WARNINGS = Integer.getInteger("gtnh.oracle.maxIconRenderWarnings", 50);
    private static final Map<String, String> ICONS_BY_STACK_KEY = new LinkedHashMap<String, String>();
    private static final Map<String, ItemStack> PENDING_STACKS_BY_KEY = new LinkedHashMap<String, ItemStack>();
    private static final RenderItem RENDER_ITEM = new RenderItem();
    private static final RenderBlocks RENDER_BLOCKS = new RenderBlocks();
    private static int renderWarnings;

    private ClientItemStackIconRenderer() {}

    public static String lookupIcon(ItemStack stack) {
        return captureIcon(stack);
    }

    public static String captureIcon(ItemStack stack) {
        if (stack == null || stack.getItem() == null || stack.stackSize <= 0) {
            return null;
        }

        String key = stackKey(stack);
        if (ICONS_BY_STACK_KEY.containsKey(key)) {
            String value = ICONS_BY_STACK_KEY.get(key);
            return value != null && value.length() > 0 ? value : null;
        }

        try {
            ItemStack renderStack = renderableStack(stack);
            String renderKey = stackKey(renderStack);
            String filename = existingIconFilename(renderKey);
            if (filename == null) {
                filename = safeName(renderStack) + "-" + sha1(renderKey).substring(0, 12) + ".png";
                ICONS_BY_STACK_KEY.put(renderKey, filename);
                PENDING_STACKS_BY_KEY.put(renderKey, renderStack);
            }
            ICONS_BY_STACK_KEY.put(key, filename);
            return filename;
        } catch (Throwable t) {
            ICONS_BY_STACK_KEY.put(key, "");
            warnRenderFailure(stack, t);
            return null;
        }
    }

    private static ItemStack renderableStack(ItemStack stack) {
        ItemStack renderStack = stack.copy();
        renderStack.stackSize = 1;
        if (renderStack.getItemDamage() == OreDictionary.WILDCARD_VALUE) {
            renderStack.setItemDamage(0);
        }
        return renderStack;
    }

    private static String existingIconFilename(String key) {
        if (!ICONS_BY_STACK_KEY.containsKey(key)) {
            return null;
        }
        String value = ICONS_BY_STACK_KEY.get(key);
        return value != null && value.length() > 0 ? value : null;
    }

    public static void exportRegistryIconsThen(Runnable afterExport) {
        Minecraft minecraft = Minecraft.getMinecraft();
        if (minecraft == null) {
            afterExport.run();
            return;
        }

        GtnhCalcOracleMod.LOG.info("GTNH 1.7.10 icon exporter is ready for on-demand ItemStack rendering.");
        minecraft.displayGuiScreen(new IconExportScreen(afterExport));
    }

    public static void exportQueuedIconsThen(Runnable afterExport) {
        Minecraft minecraft = Minecraft.getMinecraft();
        if (minecraft == null) {
            afterExport.run();
            return;
        }

        minecraft.displayGuiScreen(new QueuedIconExportScreen(afterExport));
    }

    static BufferedImage renderStackToImage(ItemStack stack) throws Exception {
        Minecraft minecraft = Minecraft.getMinecraft();
        if (minecraft == null || minecraft.getTextureManager() == null) {
            throw new IllegalStateException("Minecraft client is not ready.");
        }

        Framebuffer framebuffer = new Framebuffer(ICON_SIZE, ICON_SIZE, true);
        ByteBuffer buffer;
        boolean projectionPushed = false;
        boolean modelViewPushed = false;
        boolean fogWasEnabled = false;
        boolean lightmapWasEnabled = false;
        int previousShaderProgram = 0;
        boolean usedForgeItemRenderer = false;
        int glErrorAfterRender = 0;

        try {
            resetTessellator();
            framebuffer.bindFramebuffer(true);

            GL11.glViewport(0, 0, ICON_SIZE, ICON_SIZE);
            GL11.glClearColor(0.0F, 0.0F, 0.0F, 0.0F);
            GL11.glClear(GL11.GL_COLOR_BUFFER_BIT | GL11.GL_DEPTH_BUFFER_BIT);

            // This renders from whatever GL state the client happens to be in, and the
            // item quad sits 2000 units deep (see the ortho/translate below). Anything
            // the world or GUI renderer left enabled is therefore applied on top of the
            // sprite: fog at that depth saturates to a flat fog colour, an enabled
            // lightmap texture unit replaces the sampled RGB, and a stale glColor or
            // non-MODULATE texture env tints everything. All of those keep the sprite's
            // alpha while destroying its colour. Define the state explicitly rather than
            // inheriting it.
            logInheritedGlState();

            fogWasEnabled = GL11.glIsEnabled(GL11.GL_FOG);
            GL11.glDisable(GL11.GL_FOG);

            OpenGlHelper.setActiveTexture(OpenGlHelper.lightmapTexUnit);
            lightmapWasEnabled = GL11.glIsEnabled(GL11.GL_TEXTURE_2D);
            GL11.glDisable(GL11.GL_TEXTURE_2D);
            OpenGlHelper.setActiveTexture(OpenGlHelper.defaultTexUnit);

            GL11.glEnable(GL11.GL_TEXTURE_2D);
            GL11.glTexEnvi(GL11.GL_TEXTURE_ENV, GL11.GL_TEXTURE_ENV_MODE, GL11.GL_MODULATE);
            GL11.glColor4f(1.0F, 1.0F, 1.0F, 1.0F);

            // Angelica 2.x renders through shader programs. Any program still bound here
            // overrides the fixed-function state above, so the sprite's colour comes from
            // the shader while the alpha test carves its silhouette from the sampled
            // alpha. Drop back to the fixed-function pipeline for the offscreen render.
            previousShaderProgram = GL11.glGetInteger(GL20.GL_CURRENT_PROGRAM);
            if (previousShaderProgram != 0) {
                GL20.glUseProgram(0);
            }

            GL11.glMatrixMode(GL11.GL_PROJECTION);
            GL11.glPushMatrix();
            projectionPushed = true;
            GL11.glLoadIdentity();
            GL11.glOrtho(0.0D, GUI_ICON_CANVAS_SIZE, GUI_ICON_CANVAS_SIZE, 0.0D, 1000.0D, 3000.0D);

            GL11.glMatrixMode(GL11.GL_MODELVIEW);
            GL11.glPushMatrix();
            modelViewPushed = true;
            GL11.glLoadIdentity();
            GL11.glTranslatef(0.0F, 0.0F, -2000.0F);

            RenderHelper.enableGUIStandardItemLighting();
            GL11.glEnable(GL12.GL_RESCALE_NORMAL);
            FontRenderer fontRenderer = stack.getItem().getFontRenderer(stack);
            if (fontRenderer == null) {
                fontRenderer = minecraft.fontRenderer;
            }
            int itemX = (GUI_ICON_CANVAS_SIZE - GUI_ITEM_SIZE) / 2;
            int itemY = (GUI_ICON_CANVAS_SIZE - GUI_ITEM_SIZE) / 2;
            usedForgeItemRenderer = ForgeHooksClient
                .renderInventoryItem(RENDER_BLOCKS, minecraft.getTextureManager(), stack, true, 0.0F, itemX, itemY);
            if (!usedForgeItemRenderer) {
                if (isBlockItem(stack)) {
                    // Blocks go through RenderBlocks, which renders correctly here.
                    RENDER_ITEM.renderItemIntoGUI(
                        fontRenderer,
                        minecraft.getTextureManager(),
                        stack,
                        itemX,
                        itemY
                    );
                } else {
                    // Flat item sprites would go through RenderItem.renderIcon, which
                    // draws via the Tessellator. Angelica 2.x replaces the Tessellator
                    // with a batching implementation whose colour output is lost when
                    // drawing into this offscreen framebuffer, leaving every sprite a
                    // flat silhouette. Blit the sprite directly instead.
                    renderItemSpriteDirectly(minecraft, stack, itemX, itemY);
                }
            }
            glErrorAfterRender = GL11.glGetError();
            RenderHelper.disableStandardItemLighting();
            GL11.glDisable(GL12.GL_RESCALE_NORMAL);
            resetTessellator();
            GL11.glFlush();

            buffer = BufferUtils.createByteBuffer(ICON_SIZE * ICON_SIZE * 4);
            GL11.glReadPixels(0, 0, ICON_SIZE, ICON_SIZE, GL11.GL_RGBA, GL11.GL_UNSIGNED_BYTE, buffer);
        } finally {
            RenderHelper.disableStandardItemLighting();
            GL11.glDisable(GL12.GL_RESCALE_NORMAL);
            resetTessellator();
            if (lightmapWasEnabled) {
                OpenGlHelper.setActiveTexture(OpenGlHelper.lightmapTexUnit);
                GL11.glEnable(GL11.GL_TEXTURE_2D);
                OpenGlHelper.setActiveTexture(OpenGlHelper.defaultTexUnit);
            }
            if (fogWasEnabled) {
                GL11.glEnable(GL11.GL_FOG);
            }
            if (previousShaderProgram != 0) {
                GL20.glUseProgram(previousShaderProgram);
            }
            if (modelViewPushed) {
                GL11.glMatrixMode(GL11.GL_MODELVIEW);
                GL11.glPopMatrix();
            }
            if (projectionPushed) {
                GL11.glMatrixMode(GL11.GL_PROJECTION);
                GL11.glPopMatrix();
            }
            GL11.glMatrixMode(GL11.GL_MODELVIEW);
            framebuffer.unbindFramebuffer();
            framebuffer.deleteFramebuffer();
        }

        BufferedImage image = imageFromRgbaBuffer(buffer);
        logRenderPathDiagnostics(stack, usedForgeItemRenderer, glErrorAfterRender, image);
        return image;
    }

    private static boolean isBlockItem(ItemStack stack) {
        try {
            return Block.getBlockFromItem(stack.getItem()) != Blocks.air;
        } catch (Throwable ignored) {
            return false;
        }
    }

    /**
     * Draws a flat item sprite with immediate-mode GL instead of the Tessellator, honouring
     * each render pass's icon and {@code getColorFromItemStack} tint the same way
     * {@code RenderItem.renderItemIntoGUI} does for 2D items.
     */
    private static void renderItemSpriteDirectly(Minecraft minecraft, ItemStack stack, int x, int y) {
        minecraft.getTextureManager().bindTexture(TextureMap.locationItemsTexture);

        int passes = 1;
        try {
            passes = Math.max(1, stack.getItem().getRenderPasses(stack.getItemDamage()));
        } catch (Throwable ignored) {
            passes = 1;
        }

        GL11.glEnable(GL11.GL_ALPHA_TEST);
        GL11.glEnable(GL11.GL_BLEND);
        GL11.glBlendFunc(GL11.GL_SRC_ALPHA, GL11.GL_ONE_MINUS_SRC_ALPHA);

        for (int pass = 0; pass < passes; pass++) {
            IIcon icon = null;
            try {
                icon = stack.getItem().getIcon(stack, pass);
            } catch (Throwable ignored) {
                icon = null;
            }
            if (icon == null) {
                try {
                    icon = stack.getIconIndex();
                } catch (Throwable ignored) {
                    icon = null;
                }
            }
            if (icon == null) {
                continue;
            }

            int color = 0xFFFFFF;
            try {
                color = stack.getItem().getColorFromItemStack(stack, pass);
            } catch (Throwable ignored) {
                color = 0xFFFFFF;
            }

            GL11.glColor4f(
                ((color >> 16) & 255) / 255.0F,
                ((color >> 8) & 255) / 255.0F,
                (color & 255) / 255.0F,
                1.0F
            );

            GL11.glBegin(GL11.GL_QUADS);
            GL11.glTexCoord2f(icon.getMinU(), icon.getMaxV());
            GL11.glVertex3f(x, y + GUI_ITEM_SIZE, 0.0F);
            GL11.glTexCoord2f(icon.getMaxU(), icon.getMaxV());
            GL11.glVertex3f(x + GUI_ITEM_SIZE, y + GUI_ITEM_SIZE, 0.0F);
            GL11.glTexCoord2f(icon.getMaxU(), icon.getMinV());
            GL11.glVertex3f(x + GUI_ITEM_SIZE, y, 0.0F);
            GL11.glTexCoord2f(icon.getMinU(), icon.getMinV());
            GL11.glVertex3f(x, y, 0.0F);
            GL11.glEnd();
        }

        GL11.glColor4f(1.0F, 1.0F, 1.0F, 1.0F);
    }

    private static int renderPathDiagnosticsLogged;

    /**
     * Correlates the render path taken with whether the resulting icon kept its colour,
     * for the first handful of stacks. A flat icon keeps the sprite's alpha but collapses
     * to a single RGB value, so counting distinct opaque colours identifies it.
     */
    private static void logRenderPathDiagnostics(
        ItemStack stack,
        boolean usedForgeItemRenderer,
        int glError,
        BufferedImage image
    ) {
        if (renderPathDiagnosticsLogged >= 60) {
            return;
        }

        try {
            java.util.HashSet<Integer> colors = new java.util.HashSet<Integer>();
            int opaque = 0;
            for (int y = 0; y < image.getHeight(); y++) {
                for (int x = 0; x < image.getWidth(); x++) {
                    int argb = image.getRGB(x, y);
                    if (((argb >>> 24) & 255) < 200) {
                        continue;
                    }
                    opaque++;
                    colors.add(Integer.valueOf(argb & 0xFFFFFF));
                }
            }

            boolean flat = opaque > 0 && colors.size() <= 3;
            boolean blockItem = isBlockItem(stack);
            // Log every flat result, plus a few healthy sprites for comparison.
            if (!flat && (blockItem || renderPathDiagnosticsLogged >= 12)) {
                return;
            }
            renderPathDiagnosticsLogged++;

            GtnhCalcOracleMod.LOG.info(
                "GTNH icon render path:"
                    + " item=" + Item.itemRegistry.getNameForObject(stack.getItem()) + "@" + stack.getItemDamage()
                    + " itemClass=" + stack.getItem().getClass().getName()
                    + " blockItem=" + blockItem
                    + " forgeItemRenderer=" + usedForgeItemRenderer
                    + " glError=" + glError
                    + " distinctColors=" + colors.size()
                    + " opaquePx=" + opaque
                    + (flat ? "  <-- FLAT" : "")
            );
        } catch (Throwable ignored) {
            // diagnostics only
        }
    }

    private static BufferedImage renderWithContainerBaseIfNeeded(ItemStack stack, BufferedImage overlay) {
        if (!shouldRenderContainerBase(stack)) {
            return overlay;
        }

        try {
            BufferedImage base = renderContainerBaseImage(stack);
            if (base == null) {
                return overlay;
            }

            BufferedImage combined = new BufferedImage(overlay.getWidth(), overlay.getHeight(), BufferedImage.TYPE_INT_ARGB);
            Graphics2D graphics = combined.createGraphics();
            try {
                graphics.drawImage(base, 0, 0, null);
                graphics.drawImage(overlay, 0, 0, null);
            } finally {
                graphics.dispose();
            }
            return combined;
        } catch (Throwable ignored) {
            return overlay;
        }
    }

    private static BufferedImage renderContainerBaseImage(ItemStack stack) throws Exception {
        if (isCapsuleStack(stack)) {
            ItemStack capsuleBase = new ItemStack(stack.getItem(), 1, 0);
            BufferedImage capsuleImage = renderStackToImage(capsuleBase);
            if (imageHasVisiblePixels(capsuleImage) && missingTextureRatio(capsuleImage) <= 0.5D) {
                return capsuleImage;
            }
        }

        Item emptyCellItem = (Item) Item.itemRegistry.getObject("IC2:itemCellEmpty");
        return emptyCellItem == null ? null : renderStackToImage(new ItemStack(emptyCellItem, 1, 0));
    }

    private static boolean shouldRenderContainerBase(ItemStack stack) {
        String displayName;
        try {
            displayName = String.valueOf(stack.getDisplayName());
        } catch (Throwable ignored) {
            return false;
        }

        if (
            (!displayName.endsWith(" Cell") && !displayName.endsWith(" Capsule"))
                || "Empty Cell".equals(displayName)
                || "Empty Capsule".equals(displayName)
        ) {
            return false;
        }

        String registryName = String.valueOf(Item.itemRegistry.getNameForObject(stack.getItem()));
        return registryName.startsWith("gregtech:")
            || registryName.startsWith("IC2:")
            || registryName.startsWith("miscutils:")
            || registryName.startsWith("bartworks:");
    }

    private static boolean isCapsuleStack(ItemStack stack) {
        try {
            return String.valueOf(stack.getDisplayName()).endsWith(" Capsule");
        } catch (Throwable ignored) {
            return false;
        }
    }

    private static final class IconExportScreen extends GuiScreen {

        private final Runnable afterExport;
        private boolean done;

        private IconExportScreen(Runnable afterExport) {
            this.afterExport = afterExport;
        }

        @Override
        public void drawScreen(int mouseX, int mouseY, float partialTicks) {
            if (done) {
                return;
            }
            done = true;
            writeIconMap();
            GtnhCalcOracleMod.LOG.info("GTNH 1.7.10 icon exporter finished initialisation.");
            mc.displayGuiScreen(null);
            afterExport.run();
        }
    }

    private static final class QueuedIconExportScreen extends GuiScreen {

        private final Runnable afterExport;
        private final Iterator<Map.Entry<String, ItemStack>> iterator;
        private final int total;
        private int processed;
        private int rendered;
        private int cacheHits;
        private int skipped;
        private boolean finished;

        private QueuedIconExportScreen(Runnable afterExport) {
            this.afterExport = afterExport;
            this.iterator = PENDING_STACKS_BY_KEY.entrySet().iterator();
            this.total = PENDING_STACKS_BY_KEY.size();
            GtnhCalcOracleMod.LOG.info(
                "GTNH 1.7.10 item icon batch started: "
                    + total
                    + " queued, size "
                    + ICON_SIZE
                    + "px, batch "
                    + ICON_EXPORT_BATCH_SIZE
                    + "."
            );
        }

        @Override
        public void drawScreen(int mouseX, int mouseY, float partialTicks) {
            if (finished) {
                return;
            }

            int batch = 0;
            while (batch < ICON_EXPORT_BATCH_SIZE && iterator.hasNext()) {
                Map.Entry<String, ItemStack> entry = iterator.next();
                processed++;
                batch++;
                try {
                    MaterializedIconResult result = materializeIcon(entry.getKey(), entry.getValue());
                    if (result == MaterializedIconResult.RENDERED) {
                        rendered++;
                    } else if (result == MaterializedIconResult.CACHE_HIT) {
                        cacheHits++;
                    } else {
                        skipped++;
                    }
                } catch (Throwable t) {
                    skipped++;
                    ICONS_BY_STACK_KEY.put(entry.getKey(), "");
                    warnRenderFailure(entry.getValue(), t);
                }

                if (processed % ICON_PROGRESS_EVERY == 0 || processed == total) {
                    GtnhCalcOracleMod.LOG.info(
                        "GTNH item icon progress "
                            + processed
                            + "/"
                            + total
                            + " (rendered "
                            + rendered
                            + ", cache "
                            + cacheHits
                            + ", skipped "
                            + skipped
                            + ")."
                    );
                }
            }

            if (!iterator.hasNext()) {
                finished = true;
                writeIconMap();
                GtnhCalcOracleMod.LOG.info(
                    "GTNH item icon batch finished: rendered "
                        + rendered
                        + ", cache "
                        + cacheHits
                        + ", skipped "
                        + skipped
                        + "."
                );
                ClientFluidStackIconRenderer.exportQueuedIconsThen(new Runnable() {
                    @Override
                    public void run() {
                        mc.displayGuiScreen(null);
                        afterExport.run();
                    }
                });
            }
        }
    }

    private enum MaterializedIconResult {
        RENDERED,
        CACHE_HIT,
        SKIPPED
    }

    private static MaterializedIconResult materializeIcon(String key, ItemStack stack) throws Exception {
        String filename = ICONS_BY_STACK_KEY.get(key);
        if (filename == null || filename.length() == 0) {
            return MaterializedIconResult.SKIPPED;
        }

        File outDir = iconDir();
        if (!outDir.exists() && !outDir.mkdirs()) {
            return MaterializedIconResult.SKIPPED;
        }

        File outFile = new File(outDir, filename);
        if (outFile.isFile()) {
            return MaterializedIconResult.SKIPPED;
        }

        File cachedFile = cacheFileForKey(key, filename);
        if (cachedFile.isFile()) {
            if (isUsableCachedIcon(cachedFile)) {
                Files.copy(cachedFile.toPath(), outFile.toPath(), StandardCopyOption.REPLACE_EXISTING);
                return MaterializedIconResult.CACHE_HIT;
            }
            cachedFile.delete();
        }
        File legacyCachedFile = cacheFile(filename);
        if (legacyCachedFile.isFile()) {
            if (isUsableCachedIcon(legacyCachedFile)) {
                Files.copy(legacyCachedFile.toPath(), outFile.toPath(), StandardCopyOption.REPLACE_EXISTING);
                Files.copy(legacyCachedFile.toPath(), cachedFile.toPath(), StandardCopyOption.REPLACE_EXISTING);
                return MaterializedIconResult.CACHE_HIT;
            }
            legacyCachedFile.delete();
        }

        BufferedImage image = renderStackToImage(stack);
        applyMissingItemTint(stack, image);
        image = renderWithContainerBaseIfNeeded(stack, image);
        if (!imageHasVisiblePixels(image) || missingTextureRatio(image) >= 0.5D) {
            ICONS_BY_STACK_KEY.put(key, "");
            return MaterializedIconResult.SKIPPED;
        }
        ImageIO.write(image, "png", outFile);
        File cacheDir = cacheDir();
        if (!cacheDir.exists()) {
            cacheDir.mkdirs();
        }
        ImageIO.write(image, "png", cachedFile);
        return MaterializedIconResult.RENDERED;
    }

    private static boolean isUsableCachedIcon(File file) {
        try {
            BufferedImage image = ImageIO.read(file);
            return image != null && imageHasVisiblePixels(image) && missingTextureRatio(image) < 0.5D;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private static boolean loggedInheritedGlState;

    /** Records the GL state the client handed us, once, so a bad export can be explained. */
    private static void logInheritedGlState() {
        if (loggedInheritedGlState) {
            return;
        }
        loggedInheritedGlState = true;

        try {
            java.nio.FloatBuffer fogColor = BufferUtils.createFloatBuffer(16);
            GL11.glGetFloat(GL11.GL_FOG_COLOR, fogColor);
            java.nio.FloatBuffer currentColor = BufferUtils.createFloatBuffer(16);
            GL11.glGetFloat(GL11.GL_CURRENT_COLOR, currentColor);

            boolean fog = GL11.glIsEnabled(GL11.GL_FOG);
            int texEnvMode = GL11.glGetTexEnvi(GL11.GL_TEXTURE_ENV, GL11.GL_TEXTURE_ENV_MODE);

            OpenGlHelper.setActiveTexture(OpenGlHelper.lightmapTexUnit);
            boolean lightmap = GL11.glIsEnabled(GL11.GL_TEXTURE_2D);
            OpenGlHelper.setActiveTexture(OpenGlHelper.defaultTexUnit);

            GtnhCalcOracleMod.LOG.info(
                "GTNH icon exporter inherited GL state:"
                    + " fog=" + fog
                    + " fogColor=(" + fogColor.get(0) + ", " + fogColor.get(1) + ", " + fogColor.get(2) + ")"
                    + " lightmapTexUnitEnabled=" + lightmap
                    + " glColor=(" + currentColor.get(0) + ", " + currentColor.get(1) + ", "
                    + currentColor.get(2) + ", " + currentColor.get(3) + ")"
                    + " texEnvMode=0x" + Integer.toHexString(texEnvMode)
                    + " (GL_MODULATE=0x" + Integer.toHexString(GL11.GL_MODULATE) + ")"
                    + " shaderProgram=" + GL11.glGetInteger(GL20.GL_CURRENT_PROGRAM)
                    + " alphaTest=" + GL11.glIsEnabled(GL11.GL_ALPHA_TEST)
                    + " blend=" + GL11.glIsEnabled(GL11.GL_BLEND)
                    + " lighting=" + GL11.glIsEnabled(GL11.GL_LIGHTING)
                    + " boundTexture=" + GL11.glGetInteger(GL11.GL_TEXTURE_BINDING_2D)
            );
        } catch (Throwable t) {
            GtnhCalcOracleMod.LOG.warn("Could not read inherited GL state.", t);
        }
    }

    static BufferedImage imageFromRgbaBuffer(ByteBuffer buffer) {
        BufferedImage image = new BufferedImage(ICON_SIZE, ICON_SIZE, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < ICON_SIZE; y++) {
            for (int x = 0; x < ICON_SIZE; x++) {
                int index = (x + (ICON_SIZE - 1 - y) * ICON_SIZE) * 4;
                int red = buffer.get(index) & 255;
                int green = buffer.get(index + 1) & 255;
                int blue = buffer.get(index + 2) & 255;
                int alpha = buffer.get(index + 3) & 255;
                image.setRGB(x, y, (alpha << 24) | (red << 16) | (green << 8) | blue);
            }
        }
        return image;
    }

    static boolean imageHasVisiblePixels(BufferedImage image) {
        for (int y = 0; y < image.getHeight(); y++) {
            for (int x = 0; x < image.getWidth(); x++) {
                if (((image.getRGB(x, y) >>> 24) & 255) > 0) {
                    return true;
                }
            }
        }
        return false;
    }

    private static double missingTextureRatio(BufferedImage image) {
        int visiblePixels = 0;
        int missingTexturePixels = 0;
        for (int y = 0; y < image.getHeight(); y++) {
            for (int x = 0; x < image.getWidth(); x++) {
                int value = image.getRGB(x, y);
                int alpha = (value >>> 24) & 255;
                if (alpha == 0) {
                    continue;
                }

                visiblePixels++;
                int red = (value >> 16) & 255;
                int green = (value >> 8) & 255;
                int blue = value & 255;
                if (red >= 220 && green <= 40 && blue >= 220) {
                    missingTexturePixels++;
                }
            }
        }

        return visiblePixels > 0 ? (double) missingTexturePixels / (double) visiblePixels : 0.0D;
    }

    private static void applyMissingItemTint(ItemStack stack, BufferedImage image) {
        int color = stackTintColor(stack);
        if (color < 0) {
            return;
        }

        if ((color & 0x00FFFFFF) == 0x00FFFFFF || !imageLooksUntinted(image)) {
            return;
        }

        int tintRed = (color >> 16) & 255;
        int tintGreen = (color >> 8) & 255;
        int tintBlue = color & 255;

        for (int y = 0; y < image.getHeight(); y++) {
            for (int x = 0; x < image.getWidth(); x++) {
                int value = image.getRGB(x, y);
                int alpha = (value >>> 24) & 255;
                if (alpha == 0) {
                    continue;
                }

                int red = (((value >> 16) & 255) * tintRed) / 255;
                int green = (((value >> 8) & 255) * tintGreen) / 255;
                int blue = ((value & 255) * tintBlue) / 255;
                image.setRGB(x, y, (alpha << 24) | (red << 16) | (green << 8) | blue);
            }
        }
    }

    private static boolean imageLooksUntinted(BufferedImage image) {
        int visiblePixels = 0;
        int neutralPixels = 0;
        for (int y = 0; y < image.getHeight(); y++) {
            for (int x = 0; x < image.getWidth(); x++) {
                int value = image.getRGB(x, y);
                int alpha = (value >>> 24) & 255;
                if (alpha == 0) {
                    continue;
                }

                visiblePixels++;
                int red = (value >> 16) & 255;
                int green = (value >> 8) & 255;
                int blue = value & 255;
                int max = Math.max(red, Math.max(green, blue));
                int min = Math.min(red, Math.min(green, blue));
                if (max - min <= 10) {
                    neutralPixels++;
                }
            }
        }

        return visiblePixels > 0 && (double) neutralPixels / (double) visiblePixels > 0.85D;
    }

    private static int stackTintColor(ItemStack stack) {
        int gregTechColor = gregTechMaterialColor(stack);
        if (gregTechColor >= 0) {
            return gregTechColor;
        }

        try {
            return stack.getItem().getColorFromItemStack(stack, 0) & 0x00FFFFFF;
        } catch (Throwable ignored) {
            return -1;
        }
    }

    private static int gregTechMaterialColor(ItemStack stack) {
        Object item = stack.getItem();
        Class<?> type = item.getClass();
        while (type != null) {
            int methodColor = gregTechMaterialColorFromMethod(item, type, stack);
            if (methodColor >= 0) {
                return methodColor;
            }

            int fieldColor = gregTechMaterialColorFromField(item, type, stack.getItemDamage());
            if (fieldColor >= 0) {
                return fieldColor;
            }
            type = type.getSuperclass();
        }

        return -1;
    }

    private static int gregTechMaterialColorFromMethod(Object item, Class<?> type, ItemStack stack) {
        String[] methodNames = new String[] { "getRGBa", "getRGBA" };
        for (String methodName : methodNames) {
            try {
                Method method = type.getDeclaredMethod(methodName, ItemStack.class);
                method.setAccessible(true);
                int color = colorFromRgbArray(method.invoke(item, stack));
                if (color >= 0) {
                    return color;
                }
            } catch (Throwable ignored) {
            }
        }

        return -1;
    }

    private static int gregTechMaterialColorFromField(Object item, Class<?> type, int meta) {
        try {
            Field field = type.getDeclaredField("mRGBa");
            field.setAccessible(true);
            Object table = field.get(item);
            if (table == null || !table.getClass().isArray() || meta < 0 || meta >= Array.getLength(table)) {
                return -1;
            }

            return colorFromRgbArray(Array.get(table, meta));
        } catch (Throwable ignored) {
            return -1;
        }
    }

    private static int colorFromRgbArray(Object value) {
        if (value == null || !value.getClass().isArray() || Array.getLength(value) < 3) {
            return -1;
        }

        int red = colorChannel(Array.get(value, 0));
        int green = colorChannel(Array.get(value, 1));
        int blue = colorChannel(Array.get(value, 2));
        if (red < 0 || green < 0 || blue < 0) {
            return -1;
        }

        return (red << 16) | (green << 8) | blue;
    }

    private static int colorChannel(Object value) {
        if (!(value instanceof Number)) {
            return -1;
        }
        int channel = ((Number) value).intValue();
        return Math.max(0, Math.min(255, channel));
    }

    static File iconDir() {
        String configured = System.getProperty("gtnh.oracle.iconDir");
        if (configured != null && configured.trim().length() > 0) {
            return new File(configured);
        }
        return new File(Minecraft.getMinecraft().mcDataDir, "GTNH-Calc-Oracle-Rendered-Icons");
    }

    static File cacheDir() {
        String configured = System.getProperty("gtnh.oracle.iconCacheDir");
        if (configured != null && configured.trim().length() > 0) {
            return new File(configured);
        }
        return new File(iconDir(), ".cache-" + ICON_SIZE);
    }

    static File cacheFile(String filename) {
        return new File(cacheDir(), filename);
    }

    static File cacheFileForKey(String key, String defaultFilename) {
        try {
            return new File(cacheDir(), "stack-" + sha1(key) + ".png");
        } catch (Throwable t) {
            return cacheFile(defaultFilename);
        }
    }

    static void resetTessellator() {
        String[] fieldNames = new String[] { "isDrawing", "field_78415_z" };
        for (String fieldName : fieldNames) {
            try {
                Field isDrawing = Tessellator.class.getDeclaredField(fieldName);
                isDrawing.setAccessible(true);
                if (isDrawing.getBoolean(Tessellator.instance)) {
                    isDrawing.setBoolean(Tessellator.instance, false);
                }
                return;
            } catch (Throwable ignored) {
            }
        }
    }

    private static void warnRenderFailure(ItemStack stack, Throwable throwable) {
        renderWarnings++;
        if (renderWarnings <= MAX_RENDER_WARNINGS || renderWarnings % 1000 == 0) {
            GtnhCalcOracleMod.LOG.warn(
                "GTNH 1.7.10 icon exporter failed for "
                    + stack
                    + " ("
                    + renderWarnings
                    + " failures): "
                    + throwable.toString()
            );
        }
    }

    static void writeIconMap() {
        File file = new File(iconDir(), "icon-map.json");
        FileWriter writer = null;
        try {
            writer = new FileWriter(file);
            writer.write("{\n");
            int index = 0;
            for (Map.Entry<String, String> entry : ICONS_BY_STACK_KEY.entrySet()) {
                if (index > 0) {
                    writer.write(",\n");
                }
                writer.write("  \"" + jsonEscape(entry.getKey()) + "\": \"" + jsonEscape(entry.getValue()) + "\"");
                index++;
            }
            writer.write("\n}\n");
        } catch (IOException e) {
            GtnhCalcOracleMod.LOG.warn("Could not write GTNH icon map.", e);
        } finally {
            if (writer != null) {
                try {
                    writer.close();
                } catch (IOException ignored) {
                }
            }
        }
    }

    private static String stackKey(ItemStack stack) {
        String nbt = stack.hasTagCompound() ? stack.getTagCompound().toString() : "";
        return String.valueOf(Item.itemRegistry.getNameForObject(stack.getItem()))
            + "@" + stack.getItemDamage()
            + "#" + nbt;
    }

    private static String safeName(ItemStack stack) {
        String raw;
        try {
            raw = String.valueOf(stack.getDisplayName());
        } catch (Throwable t) {
            raw = String.valueOf(Item.itemRegistry.getNameForObject(stack.getItem()));
        }
        String safe = raw.toLowerCase().replaceAll("[^a-z0-9._-]+", "_").replaceAll("^_+|_+$", "");
        return safe.length() > 0 ? safe.substring(0, Math.min(safe.length(), 60)) : "item";
    }

    static String sha1(String value) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-1");
        byte[] bytes = digest.digest(value.getBytes("UTF-8"));
        StringBuilder builder = new StringBuilder();
        for (byte b : bytes) {
            builder.append(String.format("%02x", b & 255));
        }
        return builder.toString();
    }

    private static String jsonEscape(String value) {
        return String.valueOf(value)
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r");
    }
}
