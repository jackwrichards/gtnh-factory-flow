package dev.gtnhplanner.calcoracle;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import cpw.mods.fml.common.FMLCommonHandler;
import cpw.mods.fml.common.Loader;
import dev.gtnhplanner.calcoracle.icons.FluidStackIconExporter;
import dev.gtnhplanner.calcoracle.icons.ItemStackIconExporter;
import gregtech.api.recipe.RecipeMap;
import gregtech.api.recipe.RecipeMapBackend;
import gregtech.api.util.GTRecipe;
import net.minecraft.creativetab.CreativeTabs;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.crafting.CraftingManager;
import net.minecraft.item.crafting.FurnaceRecipes;
import net.minecraft.item.crafting.IRecipe;
import net.minecraft.item.crafting.ShapedRecipes;
import net.minecraft.item.crafting.ShapelessRecipes;
import net.minecraft.nbt.NBTTagCompound;
import net.minecraft.util.ChunkCoordinates;
import net.minecraft.util.StatCollector;
import net.minecraftforge.fluids.FluidStack;
import net.minecraftforge.oredict.OreDictionary;
import net.minecraftforge.oredict.ShapedOreRecipe;
import net.minecraftforge.oredict.ShapelessOreRecipe;

import java.io.File;
import java.io.FileWriter;
import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Proxy;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.Date;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;

public final class GtnhCalcOracleExporter {

    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();
    private static final String[] GT_VOLTAGE_NAMES = new String[] {
        "ULV", "LV", "MV", "HV", "EV", "IV", "LuV", "ZPM", "UV", "UHV", "UEV", "UIV", "UXV", "OpV", "MAX"
    };
    private static final long[] GT_VOLTAGES = new long[] {
        8L, 32L, 128L, 512L, 2048L, 8192L, 32768L, 131072L, 524288L, 2097152L, 8388608L,
        33554432L, 134217728L, 536870912L, Long.MAX_VALUE
    };
    private static final HeatingCoilTier[] HEATING_COIL_TIERS = new HeatingCoilTier[] {
        new HeatingCoilTier("cupronickel", "Cupronickel", 1801, 0),
        new HeatingCoilTier("kanthal", "Kanthal", 2701, 1),
        new HeatingCoilTier("nichrome", "Nichrome", 3601, 2),
        new HeatingCoilTier("tpv", "TPV-Alloy", 4501, 3),
        new HeatingCoilTier("hss_g", "HSS-G", 5401, 4),
        new HeatingCoilTier("hss_s", "HSS-S", 6301, 5),
        new HeatingCoilTier("naquadah", "Naquadah", 7201, 6),
        new HeatingCoilTier("naquadah_alloy", "Naquadah Alloy", 8101, 7),
        new HeatingCoilTier("trinium", "Trinium", 9001, 8),
        new HeatingCoilTier("electrum_flux", "Electrum Flux", 9901, 9),
        new HeatingCoilTier("awakened_draconium", "Awakened Draconium", 10801, 10),
        new HeatingCoilTier("infinity", "Infinity", 11701, 11),
        new HeatingCoilTier("hypogen", "Hypogen", 12601, 12),
        new HeatingCoilTier("eternal", "Eternal", 13501, 13)
    };
    private Map<String, List<String>> oreDictionaryNamesByChoiceSignature;
    private Map<String, List<Map<String, Object>>> recipeMapCatalystsById;

    public ExportResult export() throws Exception {
        String generatedAt = isoNow();
        List<Map<String, Object>> adapters = new ArrayList<Map<String, Object>>();
        List<Map<String, Object>> domains = new ArrayList<Map<String, Object>>();

        domains.add(exportOreDictionary(adapters));
        domains.add(exportGregtech(adapters));
        domains.add(exportCrafting(adapters));
        domains.add(exportSmelting(adapters));
        domains.add(exportThaumcraft(adapters));
        domains.add(exportForestryBees(adapters));
        domains.add(exportIc2Crops(adapters));
        domains.add(exportCropsNhCrops(adapters));

        Map<String, Object> root = map();
        root.put("schemaVersion", Integer.valueOf(1));
        root.put("exporter", "gtnh-calculation-oracle");
        root.put("format", "dev.gtnhplanner.oracle.v1");
        root.put("generatedAt", generatedAt);
        root.put("minecraftVersion", "1.7.10");
        root.put("loadedMods", loadedMods());
        root.put("adapters", adapters);
        root.put("domains", domains);

        int recipeCount = countRecipes(domains);
        root.put("recipeCount", Integer.valueOf(recipeCount));

        File outputDir = new File(System.getProperty("gtnh.oracle.outputDir", "GTNH-Calc-Oracle"));
        if (!outputDir.isDirectory() && !outputDir.mkdirs()) {
            throw new IllegalStateException("Could not create oracle output directory: " + outputDir);
        }

        File outputFile = new File(outputDir, "gtnh-oracle-" + safeTimestamp(generatedAt) + ".json");
        FileWriter writer = new FileWriter(outputFile);
        try {
            GSON.toJson(root, writer);
            writer.write('\n');
        } finally {
            writer.close();
        }

        return new ExportResult(outputFile.getAbsolutePath(), recipeCount, adapters.size());
    }

    private Map<String, Object> exportOreDictionary(List<Map<String, Object>> adapters) {
        long started = System.currentTimeMillis();
        Map<String, Object> domain = domain("oreDictionary");
        Map<String, Object> entries = map();
        int stackCount = 0;

        for (String name : OreDictionary.getOreNames()) {
            List<Map<String, Object>> alternatives = new ArrayList<Map<String, Object>>();
            for (ItemStack stack : OreDictionary.getOres(name)) {
                Map<String, Object> item = itemStack(stack);
                if (item != null) {
                    alternatives.add(item);
                    stackCount++;
                }
            }
            entries.put(name, alternatives);
        }

        domain.put("entries", entries);
        adapters.add(adapter("ore-dictionary", "computed", true, entries.size(), stackCount, started, null));
        return domain;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> exportGregtech(List<Map<String, Object>> adapters) {
        long started = System.currentTimeMillis();
        Map<String, Object> domain = domain("gregtech");
        List<Map<String, Object>> recipeMaps = new ArrayList<Map<String, Object>>();
        int recipeCount = 0;

        try {
            List<RecipeMap<RecipeMapBackend>> maps = new ArrayList<RecipeMap<RecipeMapBackend>>();
            for (RecipeMap<?> recipeMap : RecipeMap.ALL_RECIPE_MAPS.values()) {
                try {
                    maps.add((RecipeMap<RecipeMapBackend>) recipeMap);
                } catch (ClassCastException ignored) {
                }
            }
            Collections.sort(maps, new java.util.Comparator<RecipeMap<RecipeMapBackend>>() {
                @Override
                public int compare(RecipeMap<RecipeMapBackend> left, RecipeMap<RecipeMapBackend> right) {
                    return safeString(left.unlocalizedName).compareTo(safeString(right.unlocalizedName));
                }
            });

            for (RecipeMap<RecipeMapBackend> map : maps) {
                Map<String, Object> exportedMap = map();
                String name = StatCollector.translateToLocal(map.unlocalizedName);
                if (name == null || name.length() == 0 || name.equals(map.unlocalizedName)) {
                    name = map.unlocalizedName;
                }
                exportedMap.put("id", safeString(map.unlocalizedName));
                exportedMap.put("name", name);
                exportedMap.put("sourceClass", map.getClass().getName());
                List<Map<String, Object>> catalysts = recipeMapCatalysts(map);
                if (!catalysts.isEmpty()) {
                    exportedMap.put("catalysts", catalysts);
                    exportedMap.put("icon", catalysts.get(0).get("resource"));
                }

                List<Map<String, Object>> recipes = new ArrayList<Map<String, Object>>();
                List<GTRecipe> rawRecipes = new ArrayList<GTRecipe>(map.getAllRecipes());
                Collections.sort(rawRecipes, new java.util.Comparator<GTRecipe>() {
                    @Override
                    public int compare(GTRecipe left, GTRecipe right) {
                        int outputCompare = firstOutputName(left).compareTo(firstOutputName(right));
                        if (outputCompare != 0) return outputCompare;
                        int eutCompare = Long.compare(left.mEUt, right.mEUt);
                        if (eutCompare != 0) return eutCompare;
                        return Integer.compare(left.mDuration, right.mDuration);
                    }
                });

                int index = 0;
                for (GTRecipe recipe : rawRecipes) {
                    if (!recipe.mEnabled || recipe.mDuration <= 0) {
                        continue;
                    }

                    Map<String, Object> exportedRecipe = map();
                    exportedRecipe.put("id", sha1(map.unlocalizedName + ":" + index + ":" + recipe.toString()).substring(0, 16));
                    exportedRecipe.put("enabled", Boolean.TRUE);
                    exportedRecipe.put("durationTicks", Integer.valueOf(recipe.mDuration));
                    exportedRecipe.put("eut", Long.valueOf(recipe.mEUt));
                    exportedRecipe.put("specialValue", Integer.valueOf(recipe.mSpecialValue));
                    exportedRecipe.put("itemInputs", itemStacks(recipe.mInputs, getInputChances(recipe, recipe.mInputs.length), true));
                    exportedRecipe.put("itemOutputs", outputItemStacks(recipe));
                    exportedRecipe.put("fluidInputs", fluidStacks(recipe.mFluidInputs));
                    exportedRecipe.put("fluidOutputs", fluidStacks(recipe.mFluidOutputs));
                    exportedRecipe.put("nonConsumedInputs", specialItems(recipe.mSpecialItems));
                    exportedRecipe.put("runtimeCalculation", buildGtRuntimeCalculation(map.unlocalizedName, name, recipe));
                    recipes.add(exportedRecipe);
                    index++;
                }

                exportedMap.put("recipes", recipes);
                recipeCount += recipes.size();
                recipeMaps.add(exportedMap);
            }

            domain.put("recipeMaps", recipeMaps);
            adapters.add(adapter("gregtech-recipe-maps", "computed", true, recipeMaps.size(), recipeCount, started, null));
        } catch (Throwable t) {
            adapters.add(adapter("gregtech-recipe-maps", "missing", true, 0, recipeCount, started, t.toString()));
        }

        return domain;
    }

    private Map<String, Object> exportCrafting(List<Map<String, Object>> adapters) {
        long started = System.currentTimeMillis();
        Map<String, Object> domain = domain("crafting");
        List<Map<String, Object>> recipes = new ArrayList<Map<String, Object>>();

        try {
            List<?> rawRecipes = CraftingManager.getInstance().getRecipeList();
            int index = 0;
            for (Object raw : rawRecipes) {
                if (!(raw instanceof IRecipe)) {
                    continue;
                }
                IRecipe recipe = (IRecipe) raw;
                ItemStack output = recipe.getRecipeOutput();
                if (output == null) {
                    continue;
                }
                Map<String, Object> exported = map();
                exported.put("id", sha1("crafting:" + index + ":" + raw.getClass().getName() + ":" + stackKey(output)).substring(0, 16));
                exported.put("className", raw.getClass().getName());
                exported.put("type", craftingType(raw));
                exported.put("width", readIntField(raw, "recipeWidth"));
                exported.put("height", readIntField(raw, "recipeHeight"));
                exported.put("inputs", craftingInputs(raw));
                exported.put("output", itemStack(output));
                recipes.add(exported);
                index++;
            }
            domain.put("recipes", recipes);
            adapters.add(adapter("minecraft-forge-crafting", "computed", true, 1, recipes.size(), started, null));
        } catch (Throwable t) {
            adapters.add(adapter("minecraft-forge-crafting", "missing", true, 0, recipes.size(), started, t.toString()));
        }

        return domain;
    }

    private Map<String, Object> exportSmelting(List<Map<String, Object>> adapters) {
        long started = System.currentTimeMillis();
        Map<String, Object> domain = domain("smelting");
        List<Map<String, Object>> recipes = new ArrayList<Map<String, Object>>();

        try {
            Map<?, ?> smelting = FurnaceRecipes.smelting().getSmeltingList();
            int index = 0;
            for (Map.Entry<?, ?> entry : smelting.entrySet()) {
                if (!(entry.getKey() instanceof ItemStack) || !(entry.getValue() instanceof ItemStack)) {
                    continue;
                }
                Map<String, Object> recipe = map();
                recipe.put("id", sha1("smelting:" + index + ":" + stackKey((ItemStack) entry.getKey())).substring(0, 16));
                recipe.put("input", itemStack((ItemStack) entry.getKey()));
                recipe.put("output", itemStack((ItemStack) entry.getValue()));
                recipes.add(recipe);
                index++;
            }
            domain.put("recipes", recipes);
            adapters.add(adapter("minecraft-furnace", "computed", true, 1, recipes.size(), started, null));
        } catch (Throwable t) {
            adapters.add(adapter("minecraft-furnace", "missing", true, 0, recipes.size(), started, t.toString()));
        }

        return domain;
    }

    private Map<String, Object> exportThaumcraft(List<Map<String, Object>> adapters) {
        long started = System.currentTimeMillis();
        Map<String, Object> domain = domain("thaumcraft");
        List<Map<String, Object>> recipes = new ArrayList<Map<String, Object>>();
        boolean present = isClassPresent("thaumcraft.api.ThaumcraftApi") || GtnhCalcOracleMod.isModLoaded("Thaumcraft");
        Map<String, Map<String, Object>> neiLayoutsBySignature = Collections.emptyMap();

        if (!present) {
            adapters.add(adapter("thaumcraft-crafting", "not_present", false, 0, 0, started, null));
            domain.put("recipes", recipes);
            return domain;
        }

        try {
            unlockThaumcraftKnowledgeForOracle();
            neiLayoutsBySignature = exportThaumcraftNeiLayoutsBySignature(adapters);
            Class<?> api = Class.forName("thaumcraft.api.ThaumcraftApi");
            for (Field field : api.getDeclaredFields()) {
                if (!Modifier.isStatic(field.getModifiers()) || !Collection.class.isAssignableFrom(field.getType())) {
                    continue;
                }
                String fieldName = field.getName().toLowerCase(Locale.ROOT);
                if (!fieldName.contains("recipe")) {
                    continue;
                }
                field.setAccessible(true);
                Collection<?> rawRecipes = (Collection<?>) field.get(null);
                if (rawRecipes == null) {
                    continue;
                }
                int index = 0;
                for (Object rawRecipe : rawRecipes) {
                    Map<String, Object> recipe = thaumcraftRecipe(field.getName(), index, rawRecipe);
                    if (recipe != null) {
                        Map<String, Object> neiLayout = neiLayoutsBySignature.get(thaumcraftRecipeSignature(recipe));
                        if (neiLayout == null) {
                            neiLayout = neiLayoutsBySignature.get(thaumcraftSimpleRecipeSignature(recipe));
                        }
                        putIfPresent(recipe, "neiLayout", neiLayout);
                        recipes.add(recipe);
                    }
                    index++;
                }
            }
            int essentiaSmeltingCount = addThaumcraftEssentiaSmeltingRecipes(recipes);
            domain.put("recipes", recipes);
            adapters.add(adapter("thaumcraft-crafting", "computed", true, 1, recipes.size(), started, null));
            adapters.add(
                adapter(
                    "thaumcraft-essentia-smelting",
                    essentiaSmeltingCount > 0 ? "computed" : "partial",
                    true,
                    1,
                    essentiaSmeltingCount,
                    started,
                    essentiaSmeltingCount > 0 ? null : "No Thaumcraft object aspect tags were exportable."
                )
            );
        } catch (Throwable t) {
            adapters.add(adapter("thaumcraft-crafting", "partial", true, 0, recipes.size(), started, t.toString()));
            domain.put("recipes", recipes);
        }

        return domain;
    }

    private int addThaumcraftEssentiaSmeltingRecipes(List<Map<String, Object>> recipes) throws Exception {
        Class<?> api = Class.forName("thaumcraft.api.ThaumcraftApi");
        Class<?> aspectListClass = Class.forName("thaumcraft.api.aspects.AspectList");
        Class<?> craftingManager = Class.forName("thaumcraft.common.lib.crafting.ThaumcraftCraftingManager");
        Method getObjectTags = craftingManager.getMethod("getObjectTags", ItemStack.class);
        Method getBonusTags = craftingManager.getMethod("getBonusTags", ItemStack.class, aspectListClass);
        Field objectTagsField = api.getField("objectTags");
        Object rawObjectTags = objectTagsField.get(null);
        if (!(rawObjectTags instanceof Map)) {
            return 0;
        }

        Map<String, Boolean> seen = new LinkedHashMap<String, Boolean>();
        List<ItemStack> stacks = new ArrayList<ItemStack>();
        for (Object key : ((Map<?, ?>) rawObjectTags).keySet()) {
            for (ItemStack stack : thaumcraftObjectTagStacks(key)) {
                if (stack == null) {
                    continue;
                }
                String stackKey = stackKey(stack);
                if (seen.containsKey(stackKey)) {
                    continue;
                }
                seen.put(stackKey, Boolean.TRUE);
                stacks.add(stack);
            }
        }
        Collections.sort(stacks, new java.util.Comparator<ItemStack>() {
            @Override
            public int compare(ItemStack left, ItemStack right) {
                return stackKey(left).compareTo(stackKey(right));
            }
        });

        int exported = 0;
        for (ItemStack stack : stacks) {
            Object aspects = getObjectTags.invoke(null, stack);
            aspects = getBonusTags.invoke(null, stack, aspects);
            List<Map<String, Object>> outputs = aspectResources(aspects);
            if (outputs.isEmpty()) {
                continue;
            }

            Map<String, Object> input = itemStack(stack);
            if (input == null) {
                continue;
            }

            int durationTicks = thaumcraftAlchemyFurnaceDurationTicks(outputs, 0);
            Map<String, Object> recipe = map();
            recipe.put("id", sha1("thaumcraft:essentia-smelting:" + stackKey(stack)).substring(0, 16));
            recipe.put("sourceList", "objectTags");
            recipe.put("type", "essentiaSmelting");
            recipe.put("className", "thaumcraft.common.tiles.TileAlchemyFurnace");
            recipe.put("input", input);
            recipe.put("output", outputs.get(0));
            recipe.put("outputs", outputs);
            recipe.put("aspects", outputs);
            recipe.put("durationTicks", Integer.valueOf(durationTicks));
            recipe.put("durationSource", "thaumcraft.common.tiles.TileAlchemyFurnace.canSmelt");
            recipe.put("durationFormula", "visSize(aspects) * 10 * (1 - 0.125 * bellows)");
            recipe.put("durationBellows", Integer.valueOf(0));
            recipe.put("variants", thaumcraftAlchemyFurnaceVariants(outputs));
            recipe.put(
                "notes",
                "Essentia result exported through ThaumcraftCraftingManager.getObjectTags/getBonusTags. The Alchemical Furnace burns the item; Alembics only store and transport the resulting essentia."
            );
            recipes.add(recipe);
            exported++;
        }
        return exported;
    }

    private List<ItemStack> thaumcraftObjectTagStacks(Object key) {
        List<ItemStack> stacks = new ArrayList<ItemStack>();
        if (!(key instanceof List)) {
            return stacks;
        }
        List<?> parts = (List<?>) key;
        if (parts.size() < 2 || !(parts.get(0) instanceof Item) || !(parts.get(1) instanceof Number)) {
            return stacks;
        }
        Item item = (Item) parts.get(0);
        int meta = ((Number) parts.get(1)).intValue();
        if (meta == OreDictionary.WILDCARD_VALUE) {
            addWildcardItemStacks(stacks, item);
            return stacks;
        }
        stacks.add(new ItemStack(item, 1, meta));
        return stacks;
    }

    private void addWildcardItemStacks(List<ItemStack> stacks, Item item) {
        Map<String, Boolean> seen = new LinkedHashMap<String, Boolean>();
        addUniqueStack(stacks, seen, new ItemStack(item, 1, 0));

        if (!item.getHasSubtypes()) {
            return;
        }

        List<ItemStack> subItems = new ArrayList<ItemStack>();
        collectSubItems(item, null, subItems);
        if (subItems.isEmpty()) {
            collectSubItems(item, item.getCreativeTab(), subItems);
        }
        for (ItemStack subItem : subItems) {
            addUniqueStack(stacks, seen, subItem);
        }
    }

    @SuppressWarnings({ "unchecked", "rawtypes" })
    private void collectSubItems(Item item, CreativeTabs tab, List<ItemStack> subItems) {
        try {
            item.getSubItems(item, tab, (List) subItems);
        } catch (Throwable ignored) {
        }
    }

    private void addUniqueStack(List<ItemStack> stacks, Map<String, Boolean> seen, ItemStack stack) {
        if (stack == null || stack.getItem() == null) {
            return;
        }
        String key = stackKey(stack);
        if (seen.containsKey(key)) {
            return;
        }
        seen.put(key, Boolean.TRUE);
        stacks.add(new ItemStack(stack.getItem(), 1, stack.getItemDamage()));
    }

    private int thaumcraftAlchemyFurnaceDurationTicks(List<Map<String, Object>> aspects, int bellows) {
        int visSize = 0;
        for (Map<String, Object> aspect : aspects) {
            Number amount = asNumber(aspect.get("amount"));
            if (amount != null && amount.intValue() > 0) {
                visSize += amount.intValue();
            }
        }
        double bellowsMultiplier = 1.0D - (0.125D * Math.max(0, bellows));
        return Math.max(1, (int) (visSize * 10.0D * bellowsMultiplier));
    }

    private List<Map<String, Object>> thaumcraftAlchemyFurnaceVariants(List<Map<String, Object>> aspects) {
        List<Map<String, Object>> variants = new ArrayList<Map<String, Object>>();
        for (int bellows = 0; bellows <= 6; bellows++) {
            Map<String, Object> variant = map();
            variant.put("id", "bellows-" + bellows);
            variant.put("label", bellows == 0 ? "No bellows" : bellows + " bellows");
            variant.put("bellows", Integer.valueOf(bellows));
            variant.put("durationTicks", Integer.valueOf(thaumcraftAlchemyFurnaceDurationTicks(aspects, bellows)));
            variants.add(variant);
        }
        return variants;
    }

    private Map<String, Map<String, Object>> exportThaumcraftNeiLayoutsBySignature(List<Map<String, Object>> adapters) {
        long started = System.currentTimeMillis();
        Map<String, Map<String, Object>> layoutsBySignature = new LinkedHashMap<String, Map<String, Object>>();

        if (!FMLCommonHandler.instance().getSide().isClient()) {
            return layoutsBySignature;
        }

        String[][] handlers = new String[][] {
            { "infusion", "ru.timeconqueror.tcneiadditions.nei.TCNAInfusionRecipeHandler" },
            { "crucible", "ru.timeconqueror.tcneiadditions.nei.TCNACrucibleRecipeHandler" },
            { "arcane", "ru.timeconqueror.tcneiadditions.nei.arcaneworkbench.ArcaneCraftingShapedHandler" },
            { "arcane", "ru.timeconqueror.tcneiadditions.nei.arcaneworkbench.ArcaneCraftingShapelessHandler" },
            { "infusion", "com.djgiannuzz.thaumcraftneiplugin.nei.recipehandler.InfusionRecipeHandler" },
            { "crucible", "com.djgiannuzz.thaumcraftneiplugin.nei.recipehandler.CrucibleRecipeHandler" },
            { "arcane", "com.djgiannuzz.thaumcraftneiplugin.nei.recipehandler.ArcaneShapedRecipeHandler" },
            { "arcane", "com.djgiannuzz.thaumcraftneiplugin.nei.recipehandler.ArcaneShapelessRecipeHandler" }
        };

        int exported = 0;
        List<String> warnings = new ArrayList<String>();
        for (String[] handlerInfo : handlers) {
            String type = handlerInfo[0];
            String className = handlerInfo[1];
            if (!isClassPresent(className)) {
                continue;
            }
            try {
                Object handler = Class.forName(className).getConstructor().newInstance();
                Object overlay = invokeBest(handler, "getOverlayIdentifier", new Object[0]);
                if (overlay == null) {
                    continue;
                }
                String recipeName = safeString(invokeBest(handler, "getRecipeName", new Object[0]));
                invokeBest(handler, "loadCraftingRecipes", new Object[] { safeString(overlay), new Object[0] });
                List<?> cachedRecipes = listField(handler, "arecipes");
                int index = 0;
                for (Object cachedRecipe : cachedRecipes) {
                    Map<String, Object> layout = thaumcraftNeiLayout(
                        handler,
                        type,
                        className,
                        safeString(overlay),
                        recipeName,
                        index,
                        cachedRecipe
                    );
                    index++;
                    if (layout == null) {
                        continue;
                    }
                    String signature = safeString(layout.get("signature"));
                    if (signature.length() == 0 || layoutsBySignature.containsKey(signature)) {
                        continue;
                    }
                    layoutsBySignature.put(signature, layout);
                    String simpleSignature = safeString(layout.get("simpleSignature"));
                    if (simpleSignature.length() > 0 && !layoutsBySignature.containsKey(simpleSignature)) {
                        layoutsBySignature.put(simpleSignature, layout);
                    }
                    exported++;
                }
            } catch (Throwable t) {
                warnings.add(className + ": " + t.toString());
            }
        }

        adapters.add(
            adapter(
                "thaumcraft-nei-layouts",
                warnings.isEmpty() ? "computed" : "partial",
                true,
                handlers.length,
                exported,
                started,
                warnings.isEmpty() ? null : join(warnings, "; ")
            )
        );
        return layoutsBySignature;
    }

    private Map<String, Object> thaumcraftNeiLayout(
        Object handler,
        String type,
        String handlerClass,
        String overlayIdentifier,
        String recipeName,
        int recipeIndex,
        Object cachedRecipe
    ) {
        Object result = invokeBest(cachedRecipe, "getResult", new Object[0]);
        List<Map<String, Object>> slots = new ArrayList<Map<String, Object>>();
        Map<String, Object> output = positionedStackSlot("output", 0, result);
        if (output != null) {
            slots.add(output);
        }

        int inputIndex = 0;
        for (Object ingredient : listFrom(invokeBest(cachedRecipe, "getIngredients", new Object[0]))) {
            Map<String, Object> slot = positionedStackSlot("input", inputIndex, ingredient);
            if (slot != null) {
                slots.add(slot);
                inputIndex++;
            }
        }
        for (Object other : listFrom(invokeBest(cachedRecipe, "getOtherStacks", new Object[0]))) {
            Map<String, Object> slot = positionedStackSlot("input", inputIndex, other);
            if (slot != null) {
                slots.add(slot);
                inputIndex++;
            }
        }

        if (output == null || slots.size() <= 1) {
            return null;
        }

        Map<String, Object> layout = map();
        layout.put("source", "gtnh-nei-handler");
        layout.put("type", type);
        layout.put("handlerClass", handlerClass);
        layout.put("overlayIdentifier", overlayIdentifier);
        putIfPresent(layout, "recipeName", recipeName);
        putIfPresent(layout, "category", thaumcraftNeiCategory(type, handlerClass, overlayIdentifier, recipeName));
        layout.put("recipeIndex", Integer.valueOf(recipeIndex));
        layout.put("signature", thaumcraftNeiLayoutSignature(type, output, slots));
        layout.put("simpleSignature", type + ":" + resourceKey((Map<?, ?>) output.get("resource")));
        layout.put("slots", slots);
        layout.put("canvas", thaumcraftNeiCanvas(type, slots));
        putIfPresent(layout, "backgroundImage", captureNeiBackground(handler, recipeIndex, layout));
        return layout;
    }

    private Map<String, Object> thaumcraftNeiCategory(
        String type,
        String handlerClass,
        String overlayIdentifier,
        String recipeName
    ) {
        Map<String, Object> category = map();
        category.put("source", "gtnh-nei-handler");
        category.put("type", type);
        category.put("handlerClass", handlerClass);
        category.put("overlayIdentifier", overlayIdentifier);
        putIfPresent(category, "recipeName", recipeName);
        putIfPresent(category, "icon", thaumcraftNeiCategoryIcon(type));
        return category;
    }

    private Map<String, Object> thaumcraftNeiCategoryIcon(String type) {
        if ("infusion".equals(type)) {
            return itemStack(registryStack("Thaumcraft:blockStoneDevice", 2));
        }
        if ("crucible".equals(type)) {
            return itemStack(registryStack("Thaumcraft:blockMetalDevice", 0));
        }
        if ("arcane".equals(type)) {
            return itemStack(registryStack("Thaumcraft:blockTable", 0));
        }
        return null;
    }

    private ItemStack registryStack(String registryId, int meta) {
        Object item = Item.itemRegistry.getObject(registryId);
        return item instanceof Item ? new ItemStack((Item) item, 1, meta) : null;
    }

    private Map<String, Object> positionedStackSlot(String side, int slotIndex, Object positionedStack) {
        if (positionedStack == null) {
            return null;
        }
        Object rawItem = readField(positionedStack, "item");
        ItemStack stack = rawItem instanceof ItemStack ? (ItemStack) rawItem : null;
        if (stack == null) {
            Object rawItems = readField(positionedStack, "items");
            if (rawItems != null && rawItems.getClass().isArray() && Array.getLength(rawItems) > 0) {
                Object first = Array.get(rawItems, 0);
                stack = first instanceof ItemStack ? (ItemStack) first : null;
            }
        }

        Map<String, Object> resource = resourceFromNeiStack(stack);
        if (resource == null) {
            return null;
        }

        Number x = asNumber(readField(positionedStack, "relx"));
        Number y = asNumber(readField(positionedStack, "rely"));
        if (x == null || y == null) {
            return null;
        }

        Map<String, Object> slot = map();
        slot.put("side", side);
        slot.put("kind", resource.get("kind"));
        slot.put("slotIndex", Integer.valueOf(slotIndex));
        slot.put("x", Integer.valueOf(x.intValue()));
        slot.put("y", Integer.valueOf(y.intValue()));
        slot.put("resource", resource);
        return slot;
    }

    private Map<String, Object> resourceFromNeiStack(ItemStack stack) {
        Map<String, Object> aspect = aspectResourceFromItemAspectStack(stack);
        if (aspect != null) {
            return aspect;
        }
        return itemStack(stack);
    }

    private Map<String, Object> aspectResourceFromItemAspectStack(ItemStack stack) {
        if (stack == null || stack.getItem() == null) {
            return null;
        }
        String itemClass = stack.getItem().getClass().getName();
        if (!itemClass.endsWith(".ItemAspect") && !itemClass.contains("thaumcraftneiplugin.items.ItemAspect")) {
            return null;
        }
        try {
            Class<?> itemAspect = Class.forName("com.djgiannuzz.thaumcraftneiplugin.items.ItemAspect");
            Object aspectList = itemAspect.getMethod("getAspects", ItemStack.class).invoke(null, stack);
            List<Map<String, Object>> aspects = aspectResources(aspectList);
            if (aspects.isEmpty()) {
                return null;
            }
            Map<String, Object> aspect = aspects.get(0);
            aspect.put("amount", Integer.valueOf(Math.max(1, stack.stackSize)));
            return aspect;
        } catch (Throwable ignored) {
            return null;
        }
    }

    private Map<String, Object> thaumcraftNeiCanvas(String type, List<Map<String, Object>> slots) {
        int width = "infusion".equals(type) ? 214 : 170;
        int height = "arcane".equals(type) ? 174 : ("infusion".equals(type) ? 160 : 132);
        for (Map<String, Object> slot : slots) {
            Number x = asNumber(slot.get("x"));
            Number y = asNumber(slot.get("y"));
            if (x != null) {
                width = Math.max(width, x.intValue() + 20);
            }
            if (y != null) {
                height = Math.max(height, y.intValue() + 20);
            }
        }
        Map<String, Object> canvas = map();
        canvas.put("width", Integer.valueOf(width));
        canvas.put("height", Integer.valueOf(height));
        return canvas;
    }

    private String captureNeiBackground(Object handler, int recipeIndex, Map<String, Object> layout) {
        if ("arcane".equals(safeString(layout.get("type")))) {
            return null;
        }
        Object rawCanvas = layout.get("canvas");
        if (!(rawCanvas instanceof Map)) {
            return null;
        }
        Map<?, ?> canvas = (Map<?, ?>) rawCanvas;
        Number widthValue = asNumber(canvas.get("width"));
        Number heightValue = asNumber(canvas.get("height"));
        int width = widthValue == null ? 170 : Math.max(1, widthValue.intValue());
        int height = heightValue == null ? 82 : Math.max(1, heightValue.intValue());
        try {
            Class<?> renderer = Class.forName("dev.gtnhplanner.calcoracle.nei.ClientNeiLayoutBackgroundRenderer");
            Method method = renderer.getMethod(
                "capture",
                Object.class,
                Integer.TYPE,
                String.class,
                String.class,
                Integer.TYPE,
                Integer.TYPE
            );
            Object result = method.invoke(
                null,
                handler,
                Integer.valueOf(recipeIndex),
                safeString(layout.get("type")),
                safeString(layout.get("signature")),
                Integer.valueOf(width),
                Integer.valueOf(height)
            );
            return result == null ? null : String.valueOf(result);
        } catch (Throwable t) {
            GtnhCalcOracleMod.LOG.warn("Could not capture NEI background for {}.", safeString(layout.get("signature")), t);
            return null;
        }
    }

    private String thaumcraftRecipeSignature(Map<String, Object> recipe) {
        Object output = recipe.get("output");
        List<Object> inputs = new ArrayList<Object>();
        Object centralInput = recipe.get("centralInput");
        Object catalyst = recipe.get("catalyst");
        if (centralInput instanceof Map) {
            inputs.add(centralInput);
        }
        if (catalyst instanceof Map) {
            inputs.add(catalyst);
        }
        for (Object component : iterable(recipe.get("components"))) {
            if (component instanceof Map) {
                inputs.add(component);
            }
        }
        for (Object aspect : iterable(recipe.get("aspects"))) {
            if (aspect instanceof Map) {
                inputs.add(aspect);
            }
        }
        return safeString(recipe.get("type"))
            + ":"
            + resourceKey(output instanceof Map ? (Map<?, ?>) output : null)
            + ":"
            + sortedResourceFingerprint(inputs);
    }

    private String thaumcraftSimpleRecipeSignature(Map<String, Object> recipe) {
        Object output = recipe.get("output");
        return safeString(recipe.get("type")) + ":" + resourceKey(output instanceof Map ? (Map<?, ?>) output : null);
    }

    private String thaumcraftNeiLayoutSignature(String type, Map<String, Object> output, List<Map<String, Object>> slots) {
        List<Object> inputs = new ArrayList<Object>();
        for (Map<String, Object> slot : slots) {
            if (!"input".equals(safeString(slot.get("side")))) {
                continue;
            }
            Object resource = slot.get("resource");
            if (resource instanceof Map) {
                inputs.add(resource);
            }
        }
        return type + ":" + resourceKey((Map<?, ?>) output.get("resource")) + ":" + sortedResourceFingerprint(inputs);
    }

    private String sortedResourceFingerprint(List<Object> rawResources) {
        List<String> keys = new ArrayList<String>();
        for (Object raw : rawResources) {
            if (raw instanceof Map) {
                keys.add(resourceKeyWithAmount((Map<?, ?>) raw));
            }
        }
        Collections.sort(keys);
        return join(keys, ",");
    }

    private String resourceKey(Map<?, ?> resource) {
        if (resource == null) {
            return "";
        }
        return safeString(resource.get("kind")) + ":" + safeString(resource.get("id"));
    }

    private String resourceKeyWithAmount(Map<?, ?> resource) {
        return resourceKey(resource) + "x" + safeString(resource.get("amount"));
    }

    private Map<String, Object> exportForestryBees(List<Map<String, Object>> adapters) {
        long started = System.currentTimeMillis();
        Map<String, Object> domain = domain("forestryBees");
        List<Map<String, Object>> species = new ArrayList<Map<String, Object>>();
        boolean present = isClassPresent("forestry.api.apiculture.BeeManager") || GtnhCalcOracleMod.isModLoaded("Forestry");

        if (!present) {
            adapters.add(adapter("forestry-bee-species", "not_present", false, 0, 0, started, null));
            domain.put("species", species);
            return domain;
        }

        try {
            Class<?> alleleManager = Class.forName("forestry.api.genetics.AlleleManager");
            Object registry = readStaticField(alleleManager, "alleleRegistry");
            Class<?> chromosomeClass = Class.forName("forestry.api.apiculture.EnumBeeChromosome");
            Object speciesChromosome = Enum.valueOf((Class<Enum>) chromosomeClass.asSubclass(Enum.class), "SPECIES");
            Object alleles = invokeBest(registry, "getRegisteredAlleles", new Object[] { speciesChromosome });
            for (Object allele : iterable(alleles)) {
                Map<String, Object> exported = beeSpecies(allele);
                if (exported != null) {
                    species.add(exported);
                }
            }
            domain.put("species", species);
            adapters.add(adapter("forestry-bee-species", "computed", true, 1, species.size(), started, null));
        } catch (Throwable t) {
            adapters.add(adapter("forestry-bee-species", "partial", true, 0, species.size(), started, t.toString()));
            domain.put("species", species);
        }

        return domain;
    }

    private Map<String, Object> exportIc2Crops(List<Map<String, Object>> adapters) {
        long started = System.currentTimeMillis();
        Map<String, Object> domain = domain("ic2Crops");
        List<Map<String, Object>> crops = new ArrayList<Map<String, Object>>();
        boolean present = isClassPresent("ic2.api.crops.Crops") || GtnhCalcOracleMod.isModLoaded("IC2");

        if (!present) {
            adapters.add(adapter("ic2-crop-cards", "not_present", false, 0, 0, started, null));
            domain.put("crops", crops);
            return domain;
        }

        try {
            Object cropsApi = readStaticField(Class.forName("ic2.api.crops.Crops"), "instance");
            Set<Object> seen = Collections.newSetFromMap(new IdentityHashMap<Object, Boolean>());
            for (Method method : cropsApi.getClass().getMethods()) {
                if (method.getParameterTypes().length != 0 || !Collection.class.isAssignableFrom(method.getReturnType())) {
                    continue;
                }
                Object value = method.invoke(cropsApi);
                for (Object candidate : iterable(value)) {
                    if (candidate == null || !seen.add(candidate) || !looksLikeCropCard(candidate)) {
                        continue;
                    }
                    crops.add(cropCard(candidate));
                }
            }
            domain.put("crops", crops);
            String status = crops.isEmpty() ? "partial" : "computed";
            String warning = crops.isEmpty() ? "IC2 crop API was present, but no crop-card collection method returned cards." : null;
            adapters.add(adapter("ic2-crop-cards", status, true, 1, crops.size(), started, warning));
        } catch (Throwable t) {
            adapters.add(adapter("ic2-crop-cards", "partial", true, 0, crops.size(), started, t.toString()));
            domain.put("crops", crops);
        }

        return domain;
    }

    private Map<String, Object> thaumcraftRecipe(String sourceList, int index, Object rawRecipe) {
        if (rawRecipe == null) {
            return null;
        }

        Map<String, Object> recipe = map();
        String className = rawRecipe.getClass().getName();
        String type = thaumcraftType(className);
        recipe.put("id", sha1("thaumcraft:" + sourceList + ":" + index + ":" + className).substring(0, 16));
        recipe.put("sourceList", sourceList);
        recipe.put("type", type);
        recipe.put("className", className);
        putIfPresent(recipe, "research", firstString(rawRecipe, "research", "researchKey", "key"));
        putIfPresent(recipe, "output", resourceFromUnknown(firstObject(rawRecipe, "getRecipeOutput", "recipeOutput", "output")));
        putIfPresent(recipe, "centralInput", resourceFromUnknown(firstObject(rawRecipe, "getRecipeInput", "recipeInput", "input")));
        putIfPresent(recipe, "catalyst", resourceFromUnknown(firstObject(rawRecipe, "getCatalyst", "catalyst")));
        List<Map<String, Object>> components = resourcesFromUnknown(firstObject(rawRecipe, "getComponents", "components", "recipeItems"));
        List<Map<String, Object>> aspects = aspectResources(firstObject(rawRecipe, "getAspects", "aspects"));
        putIfPresent(recipe, "components", components);
        putIfPresent(recipe, "aspects", aspects);
        putIfPresent(recipe, "durationTicks", thaumcraftDurationTicks(type, components, aspects));
        if ("infusion".equals(type)) {
            recipe.put("durationSource", "thaumcraft.common.tiles.TileInfusionMatrix.craftCycle");
        }
        putIfPresent(recipe, "instability", firstNumber(rawRecipe, "getInstability", "instability"));
        return recipe;
    }

    private Map<String, Object> beeSpecies(Object allele) {
        if (allele == null) {
            return null;
        }

        Map<String, Object> species = map();
        putIfPresent(species, "uid", invokeString(allele, "getUID"));
        putIfPresent(species, "name", invokeString(allele, "getName"));
        species.put("className", allele.getClass().getName());
        putIfPresent(species, "input", beeMemberStack(allele));
        putIfPresent(species, "products", beeProducts(firstObject(allele, "getProductChances", "getProducts")));
        putIfPresent(species, "specialty", beeProducts(firstObject(allele, "getSpecialtyChances", "getSpecialty")));
        species.put("cycleTicks", Integer.valueOf(Integer.getInteger("gtnh.oracle.beeCycleTicks", 550)));
        return species;
    }

    private Map<String, Object> beeMemberStack(Object allele) {
        String uid = invokeString(allele, "getUID");
        if (uid == null || uid.length() == 0) {
            return null;
        }

        try {
            Object root = invokeBest(allele, "getRoot", new Object[0]);
            Object template = invokeBest(root, "getTemplate", new Object[] { uid });
            Object individual = invokeBest(root, "templateAsIndividual", new Object[] { template });
            Object beeType = Enum.valueOf(
                (Class<Enum>) Class.forName("forestry.api.apiculture.EnumBeeType").asSubclass(Enum.class),
                "PRINCESS"
            );
            Object stack = invokeBest(root, "getMemberStack", new Object[] { individual, Integer.valueOf(((Enum<?>) beeType).ordinal()) });
            return itemStack(stack instanceof ItemStack ? (ItemStack) stack : null);
        } catch (Throwable ignored) {
            return null;
        }
    }

    private List<Map<String, Object>> beeProducts(Object rawProducts) {
        List<Map<String, Object>> products = new ArrayList<Map<String, Object>>();
        if (!(rawProducts instanceof Map)) {
            return products;
        }
        for (Map.Entry<?, ?> entry : ((Map<?, ?>) rawProducts).entrySet()) {
            Map<String, Object> product = map();
            Map<String, Object> stack = itemStack(entry.getKey() instanceof ItemStack ? (ItemStack) entry.getKey() : null);
            if (stack == null) {
                continue;
            }
            product.put("resource", stack);
            Number chance = asNumber(entry.getValue());
            if (chance != null) {
                double rawChance = chance.doubleValue();
                product.put("rawChance", Double.valueOf(rawChance));
                product.put("chance", Double.valueOf(rawChance > 1.0D ? rawChance / 100.0D : rawChance));
            }
            products.add(product);
        }
        return products;
    }

    private Map<String, Object> cropCard(Object crop) {
        Map<String, Object> exported = map();
        exported.put("className", crop.getClass().getName());
        putIfPresent(exported, "id", firstString(crop, "getId", "id", "name"));
        putIfPresent(exported, "name", firstString(crop, "displayName", "getDisplayName", "name"));
        putIfPresent(exported, "owner", firstString(crop, "owner", "getOwner"));
        putIfPresent(exported, "tier", firstNumber(crop, "tier", "getTier"));
        putIfPresent(exported, "attributes", resourcesFromUnknown(firstObject(crop, "attributes", "getAttributes")));
        Object displayItem = firstObject(crop, "getDisplayItem", "getBaseSeed");
        if (displayItem == null) {
            displayItem = invokeBest(crop, "getDisplayItem", new Object[] { crop });
        }
        putIfPresent(exported, "displayItem", resourceFromUnknown(displayItem));
        List<Map<String, Object>> variants = cropVariants(crop);
        putIfPresent(exported, "variants", variants);
        if (!variants.isEmpty()) {
            putIfPresent(exported, "seed", variants.get(0).get("seed"));
            putIfPresent(exported, "drops", variants.get(0).get("drops"));
            putIfPresent(exported, "durationTicks", variants.get(0).get("durationTicks"));
        }
        exported.put(
            "notes",
            "Crop-card drops exported from the live IC2/CropsNH API using a simulated server crop tile."
        );
        return exported;
    }

    private List<Map<String, Object>> cropVariants(Object crop) {
        List<Map<String, Object>> variants = new ArrayList<Map<String, Object>>();
        addCropVariant(variants, crop, "23-31-0", "GTNH crop manager baseline 23/31/0", 23, 31, 0);
        addCropVariant(variants, crop, "31-31-31", "Perfect stats 31/31/31", 31, 31, 31);
        addCropVariant(variants, crop, "1-1-1", "Low stats 1/1/1", 1, 1, 1);
        return variants;
    }

    private void addCropVariant(
        List<Map<String, Object>> variants,
        Object crop,
        String key,
        String label,
        int growth,
        int gain,
        int resistance
    ) {
        Object tile = cropTileProxy(crop, growth, gain, resistance, cropMaxSize(crop));
        List<Map<String, Object>> drops = cropDrops(crop, tile, gain);
        if (drops.isEmpty()) {
            return;
        }

        Map<String, Object> variant = map();
        variant.put("id", key);
        variant.put("label", label);
        variant.put("growth", Integer.valueOf(growth));
        variant.put("gain", Integer.valueOf(gain));
        variant.put("resistance", Integer.valueOf(resistance));
        putIfPresent(variant, "seed", itemStack(generateCropSeed(crop, growth, gain, resistance, 4)));
        variant.put("drops", drops);
        variant.put("durationTicks", Integer.valueOf(cropDurationTicks(crop, tile)));
        variants.add(variant);
    }

    private List<Map<String, Object>> cropDrops(Object crop, Object tile, int gain) {
        int samples = Math.max(1, Integer.getInteger("gtnh.oracle.cropDropSamples", 256).intValue());
        Map<String, Map<String, Object>> resourcesByKey = new LinkedHashMap<String, Map<String, Object>>();
        Map<String, Double> amountsByKey = new LinkedHashMap<String, Double>();
        int maxSize = cropMaxSize(crop);

        for (int index = 0; index < samples; index++) {
            invokeBest(tile, "setSize", new Object[] { Byte.valueOf((byte) maxSize) });
            Object rawDrop = invokeBest(crop, "getGain", new Object[] { tile });
            if (!(rawDrop instanceof ItemStack)) {
                continue;
            }
            ItemStack drop = ((ItemStack) rawDrop).copy();
            if (drop.getItem() == null || drop.stackSize <= 0) {
                continue;
            }
            String key = stackKey(drop);
            if (key.length() == 0) {
                continue;
            }
            if (!resourcesByKey.containsKey(key)) {
                Map<String, Object> resource = itemStack(drop);
                if (resource != null) {
                    resourcesByKey.put(key, resource);
                }
            }
            Double current = amountsByKey.get(key);
            amountsByKey.put(key, Double.valueOf((current == null ? 0.0D : current.doubleValue()) + drop.stackSize));
        }

        double dropRounds = cropAverageDropRounds(crop, gain);
        double stackIncrease = (gain + 1) / 100.0D;
        List<Map<String, Object>> drops = new ArrayList<Map<String, Object>>();
        for (Map.Entry<String, Double> entry : amountsByKey.entrySet()) {
            Map<String, Object> resource = resourcesByKey.get(entry.getKey());
            if (resource == null) {
                continue;
            }
            double amount = ((entry.getValue().doubleValue() / samples) + stackIncrease) * dropRounds;
            if (!(amount > 0.0D)) {
                continue;
            }
            resource.put("amount", Double.valueOf(round(amount, 6)));
            Map<String, Object> drop = map();
            drop.put("resource", resource);
            drops.add(drop);
        }
        return drops;
    }

    private double cropAverageDropRounds(Object crop, int gain) {
        Number rawChance = asNumber(invokeBest(crop, "dropGainChance", new Object[0]));
        double chance = rawChance == null ? 1.0D : rawChance.doubleValue();
        chance *= Math.pow(1.03D, gain);

        double min = -10.0D;
        double max = 10.0D;
        int steps = 10000;
        double stepSize = (max - min) / steps;
        double sum = 0.0D;
        for (int k = 1; k <= steps - 1; k++) {
            sum += weightedDropChance(min + k * stepSize, chance);
        }
        return stepSize * ((weightedDropChance(min, chance) + weightedDropChance(max, chance)) / 2.0D + sum);
    }

    private double weightedDropChance(double x, double chance) {
        return Math.max(0L, Math.round(x * chance * 0.6827D + chance)) * stdNormDistr(x);
    }

    private double stdNormDistr(double x) {
        return Math.exp(-0.5D * x * x) / Math.sqrt(2.0D * Math.PI);
    }

    private int cropDurationTicks(Object crop, Object tile) {
        int maxSize = cropMaxSize(crop);
        int startSize = Math.max(1, Math.min(maxSize - 1, cropSizeAfterHarvest(crop, tile)));
        int tickRate = readStaticInt("ic2.core.crop.TileEntityCrop", "tickRate", 256);
        int growthRate = Math.max(1, cropGrowthRate(crop, tile));
        int totalTicks = 0;
        for (int size = startSize; size < maxSize; size++) {
            invokeBest(tile, "setSize", new Object[] { Byte.valueOf((byte) size) });
            Number duration = asNumber(invokeBest(crop, "growthDuration", new Object[] { tile }));
            int growthDuration = duration == null ? 200 : Math.max(1, duration.intValue());
            totalTicks += Math.max(1, (int) Math.ceil(growthDuration / (double) growthRate)) * tickRate;
        }
        return Math.max(1, totalTicks);
    }

    private int cropGrowthRate(Object crop, Object tile) {
        Number weight = asNumber(invokeBest(crop, "weightInfluences", new Object[] { tile, Float.valueOf(1.0F), Float.valueOf(1.0F), Float.valueOf(1.0F) }));
        if (weight != null && weight.intValue() > 0) {
            return weight.intValue();
        }
        Number growth = asNumber(invokeBest(tile, "getGrowth", new Object[0]));
        return growth == null ? 1 : Math.max(1, growth.intValue());
    }

    private int cropSizeAfterHarvest(Object crop, Object tile) {
        Number size = asNumber(invokeBest(crop, "getSizeAfterHarvest", new Object[] { tile }));
        return size == null ? Math.max(1, cropMaxSize(crop) - 1) : Math.max(1, size.intValue());
    }

    private int cropMaxSize(Object crop) {
        Number maxSize = firstNumber(crop, "maxSize", "getMaxSize");
        return maxSize == null ? 1 : Math.max(1, maxSize.intValue());
    }

    private Object cropTileProxy(final Object crop, int growth, int gain, int resistance, int size) {
        try {
            Class<?> cropTileClass = Class.forName("ic2.api.crops.ICropTile");
            final byte[] cropSize = new byte[] { (byte) Math.max(1, size) };
            final byte[] cropGrowth = new byte[] { (byte) Math.max(0, growth) };
            final byte[] cropGain = new byte[] { (byte) Math.max(0, gain) };
            final byte[] cropResistance = new byte[] { (byte) Math.max(0, resistance) };
            final NBTTagCompound customData = new NBTTagCompound();
            InvocationHandler handler = new InvocationHandler() {
                @Override
                public Object invoke(Object proxy, Method method, Object[] args) {
                    String name = method.getName();
                    if ("getCrop".equals(name)) return crop;
                    if ("setCrop".equals(name)) return null;
                    if ("getID".equals(name)) return Short.valueOf((short) cropId(crop));
                    if ("setID".equals(name)) return null;
                    if ("getSize".equals(name)) return Byte.valueOf(cropSize[0]);
                    if ("setSize".equals(name)) {
                        cropSize[0] = args != null && args.length > 0 && args[0] instanceof Number
                            ? ((Number) args[0]).byteValue()
                            : cropSize[0];
                        return null;
                    }
                    if ("getGrowth".equals(name)) return Byte.valueOf(cropGrowth[0]);
                    if ("setGrowth".equals(name)) {
                        cropGrowth[0] = args != null && args.length > 0 && args[0] instanceof Number
                            ? ((Number) args[0]).byteValue()
                            : cropGrowth[0];
                        return null;
                    }
                    if ("getGain".equals(name)) return Byte.valueOf(cropGain[0]);
                    if ("setGain".equals(name)) {
                        cropGain[0] = args != null && args.length > 0 && args[0] instanceof Number
                            ? ((Number) args[0]).byteValue()
                            : cropGain[0];
                        return null;
                    }
                    if ("getResistance".equals(name)) return Byte.valueOf(cropResistance[0]);
                    if ("setResistance".equals(name)) {
                        cropResistance[0] = args != null && args.length > 0 && args[0] instanceof Number
                            ? ((Number) args[0]).byteValue()
                            : cropResistance[0];
                        return null;
                    }
                    if ("getScanLevel".equals(name)) return Byte.valueOf((byte) 4);
                    if ("setScanLevel".equals(name)) return null;
                    if ("getCustomData".equals(name)) return customData;
                    if ("getNutrientStorage".equals(name) || "getHydrationStorage".equals(name) || "getWeedExStorage".equals(name)) {
                        return Integer.valueOf(100);
                    }
                    if ("setNutrientStorage".equals(name) || "setHydrationStorage".equals(name) || "setWeedExStorage".equals(name)) {
                        return null;
                    }
                    if ("getHumidity".equals(name) || "getNutrients".equals(name) || "getAirQuality".equals(name)) {
                        return Byte.valueOf((byte) 10);
                    }
                    if ("getWorld".equals(name)) return null;
                    if ("getLocation".equals(name)) return new ChunkCoordinates(0, 64, 0);
                    if ("getLightLevel".equals(name)) return Integer.valueOf(15);
                    if ("pick".equals(name) || "harvest".equals(name)) return Boolean.FALSE;
                    if ("harvest_automated".equals(name)) return new ItemStack[0];
                    if ("reset".equals(name) || "updateState".equals(name)) return null;
                    if ("isBlockBelow".equals(name)) return Boolean.FALSE;
                    if ("generateSeeds".equals(name)) {
                        Object seedCrop = args != null && args.length > 0 ? args[0] : crop;
                        int seedGrowth = args != null && args.length > 1 && args[1] instanceof Number ? ((Number) args[1]).intValue() : cropGrowth[0];
                        int seedGain = args != null && args.length > 2 && args[2] instanceof Number ? ((Number) args[2]).intValue() : cropGain[0];
                        int seedResistance = args != null && args.length > 3 && args[3] instanceof Number ? ((Number) args[3]).intValue() : cropResistance[0];
                        int seedScan = args != null && args.length > 4 && args[4] instanceof Number ? ((Number) args[4]).intValue() : 4;
                        return generateCropSeed(seedCrop, seedGrowth, seedGain, seedResistance, seedScan);
                    }
                    return defaultReturnValue(method.getReturnType());
                }
            };
            return Proxy.newProxyInstance(cropTileClass.getClassLoader(), new Class<?>[] { cropTileClass }, handler);
        } catch (Throwable ignored) {
            return null;
        }
    }

    private ItemStack generateCropSeed(Object crop, int growth, int gain, int resistance, int scan) {
        try {
            Object tile = Class.forName("ic2.core.crop.TileEntityCrop").newInstance();
            invokeBest(tile, "setCrop", new Object[] { crop });
            Object stack = invokeBest(
                tile,
                "generateSeeds",
                new Object[] {
                    crop,
                    Byte.valueOf((byte) growth),
                    Byte.valueOf((byte) gain),
                    Byte.valueOf((byte) resistance),
                    Byte.valueOf((byte) scan)
                }
            );
            return stack instanceof ItemStack ? (ItemStack) stack : null;
        } catch (Throwable ignored) {
            return null;
        }
    }

    private int cropId(Object crop) {
        try {
            Object cropsApi = readStaticField(Class.forName("ic2.api.crops.Crops"), "instance");
            Number id = asNumber(invokeBest(cropsApi, "getIdFor", new Object[] { crop }));
            return id == null ? 0 : id.intValue();
        } catch (Throwable ignored) {
            return 0;
        }
    }

    private Map<String, Object> exportCropsNhCrops(List<Map<String, Object>> adapters) {
        long started = System.currentTimeMillis();
        Map<String, Object> domain = domain("cropsNhCrops");
        List<Map<String, Object>> crops = new ArrayList<Map<String, Object>>();
        boolean present = isClassPresent("com.gtnewhorizon.cropsnh.api.ICropCard")
            || GtnhCalcOracleMod.isModLoaded("cropsnh");
        if (!present) {
            adapters.add(adapter("cropsnh-crop-cards", "not_present", false, 0, 0, started, null));
            domain.put("crops", crops);
            return domain;
        }

        try {
            Map<String, Object> config = map();
            config.put("growthCycleTicks", Integer.valueOf(readStaticInt(
                "com.gtnewhorizon.cropsnh.reference.Constants", "GROWTH_CYCLE_TICKS", 256)));
            putIfPresent(config, "growthMultiplier", cropsNhStaticNumber(
                "com.gtnewhorizon.cropsnh.handler.ConfigurationHandler", "growthMultiplier"));
            domain.put("config", config);

            Object registry = cropsNhRegistry();
            if (registry == null) {
                adapters.add(adapter(
                    "cropsnh-crop-cards",
                    "partial",
                    true,
                    0,
                    0,
                    started,
                    "CropsNH is loaded, but no crop registry with an iterable crop collection was found."));
                domain.put("crops", crops);
                return domain;
            }

            int seen = 0;
            for (Object card : cropsNhAllCards(registry)) {
                if (card == null) {
                    continue;
                }
                seen++;
                Map<String, Object> exported = cropsNhCropCard(card);
                if (exported != null) {
                    crops.add(exported);
                }
            }
            domain.put("crops", crops);
            String status = crops.isEmpty() ? "partial" : "computed";
            String warning = crops.isEmpty()
                ? "CropsNH crop registry was present, but no crop cards were exported."
                : null;
            adapters.add(adapter("cropsnh-crop-cards", status, true, seen, crops.size(), started, warning));
        } catch (Throwable t) {
            adapters.add(adapter("cropsnh-crop-cards", "partial", true, 0, crops.size(), started, t.toString()));
            domain.put("crops", crops);
        }
        return domain;
    }

    private Object cropsNhRegistry() {
        String[] registryClasses = new String[] {
            "com.gtnewhorizon.cropsnh.farming.registries.CropRegistry",
            "com.gtnewhorizon.cropsnh.farming.CropRegistry",
            "com.gtnewhorizon.cropsnh.api.CropsNHApi"
        };
        for (String className : registryClasses) {
            try {
                Class<?> type = Class.forName(className);
                for (String fieldName : new String[] { "instance", "INSTANCE" }) {
                    try {
                        Object registry = readStaticField(type, fieldName);
                        if (registry != null) {
                            return registry;
                        }
                    } catch (Throwable ignored) {
                    }
                }
            } catch (Throwable ignored) {
            }
        }
        return null;
    }

    private List<?> cropsNhAllCards(Object registry) {
        for (String methodName : new String[] { "getAllInRegistrationOrder", "getAll", "getCrops", "values" }) {
            Object value = invokeBest(registry, methodName, new Object[0]);
            List<?> cards = listFrom(value);
            if (!cards.isEmpty() && looksLikeCropsNhCard(cards.get(0))) {
                return cards;
            }
        }
        // Last resort: scan zero-argument methods for a collection of crop cards so a
        // renamed accessor in a future CropsNH version still exports.
        for (Method method : registry.getClass().getMethods()) {
            if (method.getParameterTypes().length != 0 || method.getDeclaringClass() == Object.class) {
                continue;
            }
            Object value = invokeBest(registry, method.getName(), new Object[0]);
            List<?> cards = listFrom(value);
            if (!cards.isEmpty() && looksLikeCropsNhCard(cards.get(0))) {
                return cards;
            }
        }
        return Collections.emptyList();
    }

    private boolean looksLikeCropsNhCard(Object value) {
        return value != null
            && hasMethod(value, "getDropTable")
            && hasMethod(value, "getGrowthDuration")
            && hasMethod(value, "getTier");
    }

    private Map<String, Object> cropsNhCropCard(Object crop) {
        if (Boolean.TRUE.equals(invokeBest(crop, "hideFromNEI", new Object[0]))) {
            return null;
        }

        List<Map<String, Object>> dropTable = new ArrayList<Map<String, Object>>();
        Object rawTable = invokeBest(crop, "getDropTable", new Object[0]);
        if (rawTable instanceof Map) {
            for (Object rawEntry : ((Map<?, ?>) rawTable).entrySet()) {
                Map.Entry<?, ?> entry = (Map.Entry<?, ?>) rawEntry;
                if (!(entry.getKey() instanceof ItemStack)) {
                    continue;
                }
                Map<String, Object> resource = itemStack((ItemStack) entry.getKey());
                if (resource == null) {
                    continue;
                }
                Number weight = asNumber(entry.getValue());
                Map<String, Object> drop = map();
                drop.put("resource", resource);
                drop.put("weight", Integer.valueOf(weight == null ? 0 : weight.intValue()));
                dropTable.add(drop);
            }
        }
        if (dropTable.isEmpty()) {
            // Weeds, the migrator, and other utility cards produce nothing harvestable.
            return null;
        }

        Map<String, Object> exported = map();
        exported.put("className", crop.getClass().getName());
        putIfPresent(exported, "id", firstString(crop, "getId"));
        putIfPresent(exported, "numericId", firstNumber(crop, "getNumericId"));
        putIfPresent(exported, "name", cropsNhCropName(crop));
        putIfPresent(exported, "unlocalizedName", firstString(crop, "getUnlocalizedName"));
        putIfPresent(exported, "creator", firstString(crop, "getCreator"));
        putIfPresent(exported, "tier", firstNumber(crop, "getTier"));
        putIfPresent(exported, "growthDuration", firstNumber(crop, "getGrowthDuration"));
        putIfPresent(exported, "minSeedBedTier", firstNumber(crop, "getMinSeedBedTier"));
        putIfPresent(exported, "machineBreedingRecipeTier", firstNumber(crop, "getMachineBreedingRecipeTier"));
        putIfPresent(exported, "dropChance", firstNumber(crop, "getDropChance"));
        exported.put("dropTable", dropTable);

        List<String> biomeTags = new ArrayList<String>();
        for (Object tag : iterable(invokeBest(crop, "getLikedBiomeTags", new Object[0]))) {
            if (tag != null) {
                biomeTags.add(String.valueOf(tag));
            }
        }
        putIfPresent(exported, "likedBiomeTags", biomeTags);

        List<String> requirements = new ArrayList<String>();
        boolean machineOnly = false;
        for (Object requirement : iterable(invokeBest(crop, "getGrowthRequirements", new Object[0]))) {
            if (requirement == null) {
                continue;
            }
            if (requirement.getClass().getName().toLowerCase(Locale.ROOT).contains("machineonly")) {
                machineOnly = true;
            }
            String description = firstString(requirement, "getDescriptionForNEI", "getDescription");
            if (description != null && description.length() > 0) {
                requirements.add(description);
            }
        }
        putIfPresent(exported, "growthRequirements", requirements);
        if (machineOnly) {
            exported.put("machineOnly", Boolean.TRUE);
        }

        putIfPresent(exported, "soils", cropsNhStackList(invokeBest(crop, "getSoilsForNEI", new Object[] { Boolean.TRUE }), 8));
        putIfPresent(exported, "blocksUnder", cropsNhStackList(invokeBest(crop, "getBlocksUnderForNEI", new Object[] { Boolean.TRUE }), 16));
        putIfPresent(exported, "alternateSeeds", cropsNhStackList(invokeBest(crop, "getAlternateSeeds", new Object[0]), 8));

        Object seedStack = invokeBest(crop, "getSeedItem", new Object[] { cropsNhSeedStatsProxy(1, 1, 1) });
        if (seedStack instanceof ItemStack) {
            putIfPresent(exported, "seed", itemStack((ItemStack) seedStack));
        }

        exported.put(
            "notes",
            "CropsNH crop card exported from the live crop registry. Drop table weights are rolled per drop"
                + " round against 10000; drop rounds average dropChance * 1.03^gain; each successful roll also"
                + " gains +1 item with probability (gain + 1) / 100.");
        return exported;
    }

    private String cropsNhCropName(Object crop) {
        String unlocalized = firstString(crop, "getUnlocalizedName");
        if (unlocalized != null && unlocalized.length() > 0) {
            String direct = StatCollector.translateToLocal(unlocalized);
            if (direct != null && direct.length() > 0 && !direct.equals(unlocalized)) {
                return direct;
            }
            String suffixed = StatCollector.translateToLocal(unlocalized + ".name");
            if (suffixed != null && suffixed.length() > 0 && !suffixed.equals(unlocalized + ".name")) {
                return suffixed;
            }
        }
        return firstString(crop, "getId");
    }

    private List<Map<String, Object>> cropsNhStackList(Object value, int limit) {
        List<Map<String, Object>> stacks = new ArrayList<Map<String, Object>>();
        for (Object entry : iterable(value)) {
            if (!(entry instanceof ItemStack)) {
                continue;
            }
            Map<String, Object> stack = itemStack((ItemStack) entry);
            if (stack != null) {
                stacks.add(stack);
                if (stacks.size() >= limit) {
                    break;
                }
            }
        }
        return stacks;
    }

    private Number cropsNhStaticNumber(String className, String fieldName) {
        try {
            Object value = readStaticField(Class.forName(className), fieldName);
            return value instanceof Number ? (Number) value : null;
        } catch (Throwable ignored) {
            return null;
        }
    }

    private Object cropsNhSeedStatsProxy(final int growth, final int gain, final int resistance) {
        try {
            Class<?> statsClass = Class.forName("com.gtnewhorizon.cropsnh.api.ISeedStats");
            InvocationHandler handler = new InvocationHandler() {
                public Object invoke(Object proxy, Method method, Object[] args) {
                    String name = method.getName();
                    if ("getGrowth".equals(name)) return Byte.valueOf((byte) growth);
                    if ("getGain".equals(name)) return Byte.valueOf((byte) gain);
                    if ("getResistance".equals(name)) return Byte.valueOf((byte) resistance);
                    if ("isAnalyzed".equals(name)) return Boolean.TRUE;
                    if ("copy".equals(name)) return proxy;
                    if ("writeToNBT".equals(name) && args != null && args.length == 1) return args[0];
                    if ("equals".equals(name) && args != null && args.length == 1) {
                        return Boolean.valueOf(args[0] == proxy);
                    }
                    if ("hashCode".equals(name)) return Integer.valueOf(System.identityHashCode(proxy));
                    if ("toString".equals(name)) return "OracleSeedStats(" + growth + "/" + gain + "/" + resistance + ")";
                    return defaultReturnValue(method.getReturnType());
                }
            };
            return Proxy.newProxyInstance(statsClass.getClassLoader(), new Class<?>[] { statsClass }, handler);
        } catch (Throwable ignored) {
            return null;
        }
    }

    private Map<String, Object> buildGtRuntimeCalculation(String recipeMapId, String recipeMapName, GTRecipe recipe) {
        Map<String, Object> out = map();
        out.put("sourceKind", "gregtech-overclock-calculator");
        out.put("sourceClass", "gregtech.api.util.OverclockCalculator");
        out.put("recipeMap", recipeMapName);
        out.put("status", "computed");
        out.put("oracleEligible", Boolean.TRUE);
        out.put("strict", Boolean.TRUE);
        out.put("generatedAt", isoNow());

        List<List<Object>> variants = new ArrayList<List<Object>>();
        int minimumTier = voltageTierForEu(recipe.mEUt);
        String profile = gtRuntimeProfile(recipeMapId, recipeMapName);
        for (int tier = minimumTier; tier < GT_VOLTAGE_NAMES.length; tier++) {
            if ("blast-furnace-heat".equals(profile)) {
                for (HeatingCoilTier coil : HEATING_COIL_TIERS) {
                    int machineHeat = coil.heat + (100 * (tier - 2));
                    if (recipe.mSpecialValue > machineHeat) {
                        continue;
                    }
                    List<Object> variant = buildGtOverclockVariant(
                        recipe,
                        tier,
                        VariantProfile.ebfHeat(recipe.mSpecialValue, machineHeat)
                    );
                    if (variant != null) {
                        variants.add(compactRuntimeVariant(variant, "ebf-heat", coil.key));
                    }
                }
                continue;
            }
            if ("pyrolyse-coil".equals(profile)) {
                for (HeatingCoilTier coil : HEATING_COIL_TIERS) {
                    List<Object> variant = buildGtOverclockVariant(
                        recipe,
                        tier,
                        VariantProfile.pyrolyse(coil.coilTier)
                    );
                    if (variant != null) {
                        variants.add(compactRuntimeVariant(variant, "pyrolyse-coil", coil.key));
                    }
                }
                continue;
            }
            if ("oil-cracker-coil".equals(profile)) {
                for (HeatingCoilTier coil : HEATING_COIL_TIERS) {
                    List<Object> variant = buildGtOverclockVariant(
                        recipe,
                        tier,
                        VariantProfile.oilCracker(coil.coilTier)
                    );
                    if (variant != null) {
                        variants.add(compactRuntimeVariant(variant, "oil-cracker-coil", coil.key));
                    }
                }
                continue;
            }
            if ("large-chemical-reactor-perfect".equals(profile)) {
                List<Object> variant = buildGtOverclockVariant(recipe, tier, VariantProfile.perfectOc());
                if (variant != null) {
                    variants.add(compactRuntimeVariant(variant, "perfect-oc", null));
                }
                continue;
            }

            List<Object> variant = buildGtOverclockVariant(recipe, tier, VariantProfile.standard());
            if (variant != null) {
                variants.add(variant);
            }
        }
        out.put("variantFormat", "tierIndex,durationTicks,eut[,profile,configKey]");
        out.put("compactVariants", variants);
        if (!"standard".equals(profile)) {
            out.put("profile", profile);
        }
        if (variants.isEmpty()) {
            out.put("status", "missing");
            List<String> warnings = new ArrayList<String>();
            warnings.add("OverclockCalculator runtime invocation did not return any variant.");
            if ("blast-furnace-heat".equals(profile) && recipe.mSpecialValue > maxSupportedBlastFurnaceHeat()) {
                out.put("oracleEligible", Boolean.FALSE);
                out.put("strict", Boolean.FALSE);
                warnings.add(
                    "Recipe heat " + recipe.mSpecialValue
                        + " K exceeds the exported EBF/Volcanus heat profiles; a Godforge/high-heat blast adapter is required."
                );
            }
            out.put("warnings", warnings);
        }
        return out;
    }

    private int maxSupportedBlastFurnaceHeat() {
        int maxHeat = 0;
        for (HeatingCoilTier coil : HEATING_COIL_TIERS) {
            for (int tier = 0; tier < GT_VOLTAGE_NAMES.length; tier++) {
                maxHeat = Math.max(maxHeat, coil.heat + (100 * (tier - 2)));
            }
        }
        return maxHeat;
    }

    private List<Object> buildGtOverclockVariant(GTRecipe recipe, int tier, VariantProfile profile) {
        try {
            Class<?> calculatorClass = Class.forName("gregtech.api.util.OverclockCalculator");
            Object calculator = calculatorClass.getConstructor().newInstance();
            callFluent(calculator, "setRecipeEUt", Long.TYPE, Long.valueOf(Math.max(0L, recipe.mEUt)));
            callFluent(calculator, "setEUt", Long.TYPE, Long.valueOf(GT_VOLTAGES[tier]));
            callFluent(calculator, "setDuration", Integer.TYPE, Integer.valueOf(Math.max(1, recipe.mDuration)));
            callFluent(calculator, "setParallel", Integer.TYPE, Integer.valueOf(1));
            if (profile.perfectOc) {
                callFluent(calculator, "enablePerfectOC");
            }
            if (profile.recipeHeat >= 0) {
                callFluent(calculator, "setRecipeHeat", Integer.TYPE, Integer.valueOf(profile.recipeHeat));
            }
            if (profile.machineHeat >= 0) {
                callFluent(calculator, "setMachineHeat", Integer.TYPE, Integer.valueOf(profile.machineHeat));
            }
            if (profile.heatOc) {
                callFluent(calculator, "setHeatOC", Boolean.TYPE, Boolean.TRUE);
            }
            if (profile.heatDiscount) {
                callFluent(calculator, "setHeatDiscount", Boolean.TYPE, Boolean.TRUE);
            }
            if (profile.durationModifier > 0.0D) {
                callFluent(calculator, "setDurationModifier", Double.TYPE, Double.valueOf(profile.durationModifier));
            }
            if (profile.eutDiscount > 0.0D) {
                callFluent(calculator, "setEUtDiscount", Double.TYPE, Double.valueOf(profile.eutDiscount));
            }
            callFluent(calculator, "calculate");

            int duration = ((Number) calculatorClass.getMethod("getDuration").invoke(calculator)).intValue();
            long eut = ((Number) calculatorClass.getMethod("getConsumption").invoke(calculator)).longValue();
            return Arrays.<Object>asList(
                Integer.valueOf(tier),
                Integer.valueOf(Math.max(1, duration)),
                Long.valueOf(Math.max(0L, eut))
            );
        } catch (Throwable ignored) {
            return null;
        }
    }

    private List<Object> compactRuntimeVariant(List<Object> base, String profile, String configKey) {
        List<Object> variant = new ArrayList<Object>(base);
        variant.add(profile);
        if (configKey != null) {
            variant.add(configKey);
        }
        return variant;
    }

    private String gtRuntimeProfile(String recipeMapId, String recipeMapName) {
        String id = safeString(recipeMapId).toLowerCase(Locale.ROOT);
        String name = safeString(recipeMapName).toLowerCase(Locale.ROOT);
        if (id.equals("gt.recipe.blastfurnace") || name.equals("blast furnace")) {
            return "blast-furnace-heat";
        }
        if (id.equals("gt.recipe.pyro") || name.equals("pyrolyse oven")) {
            return "pyrolyse-coil";
        }
        if (id.equals("gt.recipe.craker") || id.equals("gt.recipe.cracker") || name.equals("oil cracker")) {
            return "oil-cracker-coil";
        }
        if (id.equals("gt.recipe.largechemicalreactor") || name.equals("large chemical reactor")) {
            return "large-chemical-reactor-perfect";
        }
        return "standard";
    }

    private List<Map<String, Object>> gtRuntimeOutputs(GTRecipe recipe) {
        List<Map<String, Object>> outputs = new ArrayList<Map<String, Object>>();
        int outputIndex = 0;
        for (ItemStack stack : recipe.mOutputs) {
            Map<String, Object> resource = itemStack(stack);
            if (resource != null) {
                int chance = recipe.getOutputChance(outputIndex);
                if (chance > 0 && chance < 10000) {
                    resource.put("chance", Double.valueOf(chance / 10000.0D));
                }
                outputs.add(resource);
            }
            outputIndex++;
        }
        for (FluidStack stack : recipe.mFluidOutputs) {
            Map<String, Object> resource = fluidStack(stack);
            if (resource != null) {
                outputs.add(resource);
            }
        }
        return outputs;
    }

    private List<Map<String, Object>> recipeMapCatalysts(RecipeMap<?> target) {
        if (recipeMapCatalystsById == null) {
            recipeMapCatalystsById = buildRecipeMapCatalystCache();
        }
        List<Map<String, Object>> catalysts = recipeMapCatalystsById.get(safeString(target.unlocalizedName));
        return catalysts == null ? Collections.<Map<String, Object>>emptyList() : catalysts;
    }

    private Map<String, List<Map<String, Object>>> buildRecipeMapCatalystCache() {
        Map<String, List<Map<String, Object>>> byRecipeMap = new LinkedHashMap<String, List<Map<String, Object>>>();
        try {
            Object rawMetatileEntities = readStaticField(Class.forName("gregtech.api.GregTechAPI"), "METATILEENTITIES");
            for (Object metatileEntity : iterable(rawMetatileEntities)) {
                if (metatileEntity == null) {
                    continue;
                }
                Object stackValue = invokeBest(metatileEntity, "getStackForm", new Object[] { Long.valueOf(1L) });
                if (!(stackValue instanceof ItemStack)) {
                    continue;
                }
                Map<String, Object> resource = itemStack((ItemStack) stackValue);
                if (resource == null) {
                    continue;
                }
                List<String> tooltip = tooltipLines((ItemStack) stackValue);
                if (!tooltip.isEmpty()) {
                    resource.put("tooltip", tooltip);
                }

                Number priorityValue = asNumber(invokeBest(metatileEntity, "getRecipeCatalystPriority", new Object[0]));
                int priority = priorityValue == null ? 0 : priorityValue.intValue();
                List<RecipeMap<?>> availableMaps = availableRecipeMaps(metatileEntity);
                for (RecipeMap<?> recipeMap : availableMaps) {
                    if (recipeMap == null || recipeMap.unlocalizedName == null) {
                        continue;
                    }
                    Map<String, Object> catalyst = map();
                    catalyst.put("resource", resource);
                    catalyst.put("priority", Integer.valueOf(priority));
                    catalyst.put("sourceClass", metatileEntity.getClass().getName());

                    List<Map<String, Object>> entries = byRecipeMap.get(recipeMap.unlocalizedName);
                    if (entries == null) {
                        entries = new ArrayList<Map<String, Object>>();
                        byRecipeMap.put(recipeMap.unlocalizedName, entries);
                    }
                    if (!containsCatalystResource(entries, resource)) {
                        entries.add(catalyst);
                    }
                }
            }
            for (List<Map<String, Object>> catalysts : byRecipeMap.values()) {
                Collections.sort(catalysts, new java.util.Comparator<Map<String, Object>>() {
                    @Override
                    public int compare(Map<String, Object> left, Map<String, Object> right) {
                        int priorityCompare = Integer.compare(catalystPriority(right), catalystPriority(left));
                        if (priorityCompare != 0) return priorityCompare;
                        return catalystResourceId(left).compareTo(catalystResourceId(right));
                    }
                });
            }
        } catch (Throwable ignored) {
        }
        return byRecipeMap;
    }

    @SuppressWarnings("unchecked")
    private List<RecipeMap<?>> availableRecipeMaps(Object metatileEntity) {
        List<RecipeMap<?>> maps = new ArrayList<RecipeMap<?>>();
        Object rawMaps = invokeBest(metatileEntity, "getAvailableRecipeMaps", new Object[0]);
        for (Object value : iterable(rawMaps)) {
            if (value instanceof RecipeMap) {
                maps.add((RecipeMap<?>) value);
            }
        }
        if (!maps.isEmpty()) {
            return maps;
        }

        Object rawMap = invokeBest(metatileEntity, "getRecipeMap", new Object[0]);
        if (rawMap instanceof RecipeMap) {
            maps.add((RecipeMap<?>) rawMap);
        }
        return maps;
    }

    private boolean containsCatalystResource(List<Map<String, Object>> catalysts, Map<String, Object> resource) {
        String id = safeString(resource.get("id"));
        for (Map<String, Object> catalyst : catalysts) {
            Object candidate = catalyst.get("resource");
            if (candidate instanceof Map && id.equals(safeString(((Map<?, ?>) candidate).get("id")))) {
                return true;
            }
        }
        return false;
    }

    private int catalystPriority(Map<String, Object> catalyst) {
        Object priority = catalyst.get("priority");
        return priority instanceof Number ? ((Number) priority).intValue() : 0;
    }

    private String catalystResourceId(Map<String, Object> catalyst) {
        Object resource = catalyst.get("resource");
        return resource instanceof Map ? safeString(((Map<?, ?>) resource).get("id")) : "";
    }

    private List<String> tooltipLines(ItemStack stack) {
        try {
            List<?> rawTooltip = stack.getTooltip(null, false);
            List<String> tooltip = new ArrayList<String>();
            for (Object line : rawTooltip) {
                String text = String.valueOf(line).replaceAll("\\u00A7[0-9A-FK-ORa-fk-or]", "").trim();
                if (text.length() > 0) {
                    tooltip.add(text);
                }
            }
            return tooltip;
        } catch (Throwable ignored) {
            return Collections.emptyList();
        }
    }

    private Object callFluent(Object target, String methodName) throws Exception {
        Method method = target.getClass().getMethod(methodName);
        return method.invoke(target);
    }

    private Object callFluent(Object target, String methodName, Class<?> parameterType, Object value) throws Exception {
        Method method = target.getClass().getMethod(methodName, parameterType);
        return method.invoke(target, value);
    }

    private List<Map<String, Object>> outputItemStacks(GTRecipe recipe) {
        List<Map<String, Object>> outputs = new ArrayList<Map<String, Object>>();
        int index = 0;
        for (ItemStack stack : recipe.mOutputs) {
            Map<String, Object> item = itemStack(stack);
            if (item != null) {
                int chance = recipe.getOutputChance(index);
                if (chance > 0 && chance < 10000) {
                    item.put("chance", Double.valueOf(chance / 10000.0D));
                }
                outputs.add(item);
            }
            index++;
        }
        return outputs;
    }

    private List<Map<String, Object>> specialItems(Object specialItems) {
        List<Map<String, Object>> items = new ArrayList<Map<String, Object>>();
        for (Object value : iterable(specialItems)) {
            if (value instanceof ItemStack) {
                Map<String, Object> item = itemStack((ItemStack) value);
                if (item != null) {
                    item.put("consumed", Boolean.FALSE);
                    items.add(item);
                }
            }
        }
        return items;
    }

    private List<Map<String, Object>> itemStacks(ItemStack[] stacks, int[] inputChances, boolean markNonConsumed) {
        List<Map<String, Object>> items = new ArrayList<Map<String, Object>>();
        for (int index = 0; index < stacks.length; index++) {
            Map<String, Object> item = itemStack(stacks[index]);
            if (item == null) {
                continue;
            }
            if (markNonConsumed && inputChances != null && index < inputChances.length && inputChances[index] <= 0) {
                item.put("consumed", Boolean.FALSE);
            }
            items.add(item);
        }
        return items;
    }

    private List<Map<String, Object>> fluidStacks(FluidStack[] stacks) {
        List<Map<String, Object>> fluids = new ArrayList<Map<String, Object>>();
        for (FluidStack stack : stacks) {
            Map<String, Object> fluid = fluidStack(stack);
            if (fluid != null) {
                fluids.add(fluid);
            }
        }
        return fluids;
    }

    private Map<String, Object> itemStack(ItemStack stack) {
        if (stack == null || stack.getItem() == null || stack.stackSize <= 0) {
            return null;
        }

        String registryId = String.valueOf(Item.itemRegistry.getNameForObject(stack.getItem()));
        if (registryId == null || registryId.length() == 0 || "null".equals(registryId)) {
            return null;
        }

        Map<String, Object> item = map();
        int meta = stack.getItemDamage();
        item.put("kind", "item");
        item.put("id", itemResourceId(registryId, meta));
        item.put("registryId", registryId);
        item.put("meta", Integer.valueOf(meta));
        item.put("amount", Integer.valueOf(stack.stackSize));
        item.put("displayName", displayName(stack));
        String modId = modId(registryId);
        if (modId != null) {
            item.put("modId", modId);
        }
        if (stack.stackTagCompound != null) {
            item.put("nbt", stack.stackTagCompound.toString());
        }
        String icon = ItemStackIconExporter.captureIcon(stack);
        if (icon != null && icon.length() > 0) {
            item.put("icon", icon);
        }
        return item;
    }

    private Map<String, Object> fluidStack(FluidStack stack) {
        if (stack == null || stack.getFluid() == null || stack.amount <= 0) {
            return null;
        }

        Map<String, Object> fluid = map();
        fluid.put("kind", "fluid");
        fluid.put("id", stack.getFluid().getName());
        fluid.put("amount", Integer.valueOf(stack.amount));
        fluid.put("displayName", stack.getLocalizedName());
        String icon = FluidStackIconExporter.captureIcon(stack);
        if (icon != null && icon.length() > 0) {
            fluid.put("icon", icon);
        }
        return fluid;
    }

    private List<Map<String, Object>> craftingInputs(Object recipe) {
        List<Map<String, Object>> inputs = new ArrayList<Map<String, Object>>();
        if (recipe instanceof ShapedRecipes) {
            ShapedRecipes shaped = (ShapedRecipes) recipe;
            for (int index = 0; index < shaped.recipeItems.length; index++) {
                addUnknownInput(inputs, shaped.recipeItems[index], index);
            }
            return inputs;
        }
        if (recipe instanceof ShapelessRecipes) {
            ShapelessRecipes shapeless = (ShapelessRecipes) recipe;
            int index = 0;
            for (Object stack : shapeless.recipeItems) {
                addUnknownInput(inputs, stack, index++);
            }
            return inputs;
        }
        if (recipe instanceof ShapedOreRecipe) {
            Object[] rawInputs = ((ShapedOreRecipe) recipe).getInput();
            for (int index = 0; index < rawInputs.length; index++) {
                addUnknownInput(inputs, rawInputs[index], index);
            }
            return inputs;
        }
        if (recipe instanceof ShapelessOreRecipe) {
            int index = 0;
            for (Object input : ((ShapelessOreRecipe) recipe).getInput()) {
                addUnknownInput(inputs, input, index++);
            }
            return inputs;
        }

        Object recipeItems = firstObject(recipe, "getInput", "recipeItems", "input");
        int index = 0;
        for (Object input : iterable(recipeItems)) {
            addUnknownInput(inputs, input, index++);
        }
        return inputs;
    }

    private void addUnknownInput(List<Map<String, Object>> inputs, Object input, int slotIndex) {
        Map<String, Object> resource = resourceFromUnknown(input);
        if (resource != null) {
            resource.put("slotIndex", Integer.valueOf(slotIndex));
            inputs.add(resource);
        }
    }

    private Map<String, Object> resourceFromUnknown(Object input) {
        if (input == null) {
            return null;
        }
        if (input instanceof ItemStack) {
            return itemStack((ItemStack) input);
        }
        if (input instanceof FluidStack) {
            return fluidStack((FluidStack) input);
        }
        if (input instanceof String) {
            return oreDictionaryChoice(Collections.singletonList((String) input));
        }
        if (input instanceof List) {
            return stackChoice((List<?>) input);
        }
        if (input.getClass().isArray()) {
            List<Map<String, Object>> resources = resourcesFromUnknown(input);
            if (resources.size() == 1) {
                return resources.get(0);
            }
        }
        return null;
    }

    private List<Map<String, Object>> resourcesFromUnknown(Object value) {
        List<Map<String, Object>> resources = new ArrayList<Map<String, Object>>();
        for (Object entry : iterable(value)) {
            Map<String, Object> resource = resourceFromUnknown(entry);
            if (resource != null) {
                resources.add(resource);
            } else if (entry != null) {
                Map<String, Object> text = map();
                text.put("kind", "text");
                text.put("value", String.valueOf(entry));
                resources.add(text);
            }
        }
        return resources;
    }

    private Map<String, Object> oreDictionaryChoice(List<String> names) {
        Map<String, Object> choice = map();
        choice.put("kind", "oreDictionary");
        choice.put("names", names);
        return choice;
    }

    private Map<String, Object> stackChoice(List<?> rawAlternatives) {
        List<String> oreNames = oreDictionaryNamesForChoice(rawAlternatives);
        if (oreNames != null && !oreNames.isEmpty()) {
            return oreDictionaryChoice(oreNames);
        }

        List<Map<String, Object>> alternatives = new ArrayList<Map<String, Object>>();
        List<String> keys = new ArrayList<String>();
        for (Object raw : rawAlternatives) {
            if (raw instanceof ItemStack) {
                ItemStack stack = (ItemStack) raw;
                Map<String, Object> item = compactItemStack(stack);
                if (item != null) {
                    alternatives.add(item);
                    keys.add(stackKey(stack));
                }
            }
        }
        if (alternatives.isEmpty()) {
            return null;
        }
        if (alternatives.size() == 1) {
            return alternatives.get(0);
        }
        Map<String, Object> choice = map();
        choice.put("kind", "choice");
        choice.put("id", "choice:" + sha1(keys.toString()).substring(0, 16));
        choice.put("amount", Integer.valueOf(1));
        choice.put("displayName", "Item Choice");
        choice.put("alternatives", alternatives);
        return choice;
    }

    private List<String> oreDictionaryNamesForChoice(List<?> rawAlternatives) {
        if (rawAlternatives == null || rawAlternatives.isEmpty()) {
            return Collections.emptyList();
        }
        if (oreDictionaryNamesByChoiceSignature == null) {
            oreDictionaryNamesByChoiceSignature = new LinkedHashMap<String, List<String>>();
            for (String name : OreDictionary.getOreNames()) {
                String signature = choiceSignature(OreDictionary.getOres(name));
                if (signature.length() == 0) {
                    continue;
                }
                List<String> names = oreDictionaryNamesByChoiceSignature.get(signature);
                if (names == null) {
                    names = new ArrayList<String>();
                    oreDictionaryNamesByChoiceSignature.put(signature, names);
                }
                names.add(name);
            }
        }
        return oreDictionaryNamesByChoiceSignature.get(choiceSignature(rawAlternatives));
    }

    private String choiceSignature(List<?> rawAlternatives) {
        List<String> keys = new ArrayList<String>();
        for (Object raw : rawAlternatives) {
            if (raw instanceof ItemStack) {
                String key = stackKey((ItemStack) raw);
                if (key.length() > 0) {
                    keys.add(key);
                }
            }
        }
        Collections.sort(keys);
        return keys.isEmpty() ? "" : keys.toString();
    }

    private void unlockThaumcraftKnowledgeForOracle() {
        try {
            String username = thaumcraftOracleUsername();
            int aspectCount = unlockThaumcraftAspects(username);
            int researchCount = unlockThaumcraftResearch(username);
            GtnhCalcOracleMod.LOG.info(
                "GTNH calculation oracle unlocked {} Thaumcraft aspect(s) and {} research entry/entries for {}.",
                Integer.valueOf(aspectCount),
                Integer.valueOf(researchCount),
                username
            );
        } catch (Throwable t) {
            GtnhCalcOracleMod.LOG.warn("Could not pre-unlock Thaumcraft knowledge for oracle export.", t);
        }
    }

    private String thaumcraftOracleUsername() {
        String configured = System.getProperty("gtnh.oracle.thaumcraftPlayer");
        if (configured != null && configured.trim().length() > 0) {
            return configured.trim();
        }

        try {
            Class<?> minecraftClass = Class.forName("net.minecraft.client.Minecraft");
            Object minecraft = minecraftClass.getMethod("getMinecraft").invoke(null);
            Object player = readField(minecraft, "thePlayer");
            String playerName = invokeString(player, "getCommandSenderName");
            if (playerName != null && playerName.trim().length() > 0) {
                return playerName.trim();
            }
        } catch (Throwable ignored) {
        }

        return "GTNHPlannerOracle";
    }

    private int unlockThaumcraftAspects(String username) throws Exception {
        Class<?> aspectClass = Class.forName("thaumcraft.api.aspects.Aspect");
        Class<?> researchManager = Class.forName("thaumcraft.common.lib.research.ResearchManager");
        Method completeAspect = researchManager.getMethod(
            "completeAspectUnsaved",
            String.class,
            aspectClass,
            Short.TYPE
        );
        Object rawAspects = readStaticField(aspectClass, "aspects");
        int count = 0;
        for (Object aspect : mapValuesOrIterable(rawAspects)) {
            if (aspect == null) {
                continue;
            }
            completeAspect.invoke(null, username, aspect, Short.valueOf(Short.MAX_VALUE));
            count++;
        }

        try {
            Object proxy = readStaticField(Class.forName("thaumcraft.common.Thaumcraft"), "proxy");
            Object knowledge = readField(proxy, "playerKnowledge");
            invokeBest(knowledge, "addDiscoveredPrimalAspects", new Object[] { username });
            for (Object aspect : mapValuesOrIterable(rawAspects)) {
                invokeBest(knowledge, "addDiscoveredAspect", new Object[] { username, aspect });
            }
        } catch (Throwable ignored) {
        }

        return count;
    }

    private int unlockThaumcraftResearch(String username) throws Exception {
        Class<?> categoriesClass = Class.forName("thaumcraft.api.research.ResearchCategories");
        Class<?> researchManager = Class.forName("thaumcraft.common.lib.research.ResearchManager");
        Method completeResearch = researchManager.getMethod("completeResearchUnsaved", String.class, String.class);
        Object rawCategories = readStaticField(categoriesClass, "researchCategories");
        int count = 0;
        for (Object category : mapValuesOrIterable(rawCategories)) {
            Object rawResearch = readField(category, "research");
            if (!(rawResearch instanceof Map)) {
                continue;
            }
            for (Object key : ((Map<?, ?>) rawResearch).keySet()) {
                if (key == null) {
                    continue;
                }
                completeResearch.invoke(null, username, String.valueOf(key));
                count++;
            }
        }
        return count;
    }

    private Iterable<?> mapValuesOrIterable(Object value) {
        if (value instanceof Map) {
            return ((Map<?, ?>) value).values();
        }
        return iterable(value);
    }

    private Integer thaumcraftDurationTicks(
        String type,
        List<Map<String, Object>> components,
        List<Map<String, Object>> aspects
    ) {
        if ("infusion".equals(type)) {
            int essentia = 0;
            for (Map<String, Object> aspect : aspects) {
                Number amount = asNumber(aspect.get("amount"));
                if (amount != null && amount.intValue() > 0) {
                    essentia += amount.intValue();
                }
            }
            int componentCount = components == null ? 0 : components.size();
            return Integer.valueOf(10 * (essentia + componentCount * 6 + 1));
        }
        if ("crucible".equals(type)) {
            return Integer.valueOf(20);
        }
        if ("arcane".equals(type)) {
            return Integer.valueOf(1);
        }
        return null;
    }

    private List<Map<String, Object>> aspectResources(Object aspectList) {
        List<Map<String, Object>> aspects = new ArrayList<Map<String, Object>>();
        if (aspectList == null) {
            return aspects;
        }

        Object rawAspects = invokeBest(aspectList, "getAspectsSortedAmount", new Object[0]);
        if (rawAspects == null) {
            rawAspects = invokeBest(aspectList, "getAspects", new Object[0]);
        }
        for (Object aspect : iterable(rawAspects)) {
            Number amount = asNumber(invokeBest(aspectList, "getAmount", new Object[] { aspect }));
            if (amount == null || amount.doubleValue() <= 0.0D) {
                continue;
            }
            String tag = invokeString(aspect, "getTag");
            String name = invokeString(aspect, "getName");
            if (tag == null) {
                tag = safeString(aspect);
            }
            Map<String, Object> resource = map();
            resource.put("kind", "aspect");
            resource.put("id", "thaumcraft:aspect:" + tag.toLowerCase(Locale.ROOT));
            resource.put("tag", tag);
            resource.put("amount", amount);
            resource.put("displayName", name == null ? tag : name);
            putIfPresent(resource, "iconPath", aspectIconPath(aspect, tag));
            putIfPresent(resource, "dominantColor", aspectColor(aspect));
            aspects.add(resource);
        }
        return aspects;
    }

    private String aspectIconPath(Object aspect, String tag) {
        Object image = readField(aspect, "image");
        if (image == null) {
            image = invokeBest(aspect, "getImage", new Object[0]);
        }
        String location = safeString(image);
        if (location.toLowerCase(Locale.ROOT).contains("_unknown")) {
            location = "";
        }
        int separator = location.indexOf(':');
        String domain = separator > 0 ? location.substring(0, separator) : "thaumcraft";
        String resourcePath = separator > 0 ? location.substring(separator + 1) : location;
        if ("thaumcraft".equals(domain) && resourcePath.startsWith("textures/aspects/")) {
            return "/nei/thaumcraft/aspects/" + resourcePath.substring("textures/aspects/".length());
        }
        if (separator > 0 && resourcePath.startsWith("textures/")) {
            return "asset:" + domain + ":" + resourcePath;
        }
        if (isBundledThaumcraftAspect(tag)) {
            return "/nei/thaumcraft/aspects/" + tag.toLowerCase(Locale.ROOT) + ".png";
        }
        if (tag != null && tag.length() > 0) {
            return "asset:gregtech:textures/aspects/" + tag.toUpperCase(Locale.ROOT) + ".png";
        }
        if ("thaumcraft".equals(domain) && tag != null && tag.length() > 0) {
            return "/nei/thaumcraft/aspects/" + tag.toLowerCase(Locale.ROOT) + ".png";
        }
        return null;
    }

    private boolean isBundledThaumcraftAspect(String tag) {
        if (tag == null) {
            return false;
        }
        return Arrays.asList(
            "aer", "alienis", "aqua", "arbor", "auram", "bestia", "cognitio", "corpus",
            "exanimis", "fabrico", "fames", "gelum", "herba", "humanus", "ignis", "instrumentum",
            "iter", "limus", "lucrum", "lux", "machina", "messis", "metallum", "meto",
            "mortuus", "motus", "ordo", "pannus", "perditio", "perfodio", "permutatio",
            "potentia", "praecantatio", "sano", "sensus", "spiritus", "telum", "tempestas",
            "tenebrae", "terra", "tutamen", "vacuos", "venenum", "victus", "vinculum",
            "vitium", "vitreus", "volatus"
        ).contains(tag.toLowerCase(Locale.ROOT));
    }

    private String aspectColor(Object aspect) {
        Number color = asNumber(invokeBest(aspect, "getColor", new Object[0]));
        if (color == null) {
            return null;
        }
        return String.format("#%06x", Integer.valueOf(color.intValue() & 0xFFFFFF));
    }

    private Map<String, Object> compactItemStack(ItemStack stack) {
        if (stack == null || stack.getItem() == null || stack.stackSize <= 0) {
            return null;
        }

        String registryId = String.valueOf(Item.itemRegistry.getNameForObject(stack.getItem()));
        if (registryId == null || registryId.length() == 0 || "null".equals(registryId)) {
            return null;
        }

        Map<String, Object> item = map();
        int meta = stack.getItemDamage();
        item.put("kind", "item");
        item.put("id", itemResourceId(registryId, meta));
        item.put("amount", Integer.valueOf(stack.stackSize));
        item.put("displayName", displayName(stack));
        String modId = modId(registryId);
        if (modId != null) {
            item.put("modId", modId);
        }
        return item;
    }

    private int[] getInputChances(Object recipe, int inputCount) {
        int[] chances = callChanceGetter(recipe, "getInputChance", inputCount);
        return chances == null ? callChanceGetter(recipe, "getInputChances", inputCount) : chances;
    }

    private int[] callChanceGetter(Object target, String methodName, int count) {
        if (target == null || count <= 0) {
            return null;
        }
        try {
            Method method = target.getClass().getMethod(methodName, int.class);
            int[] chances = new int[count];
            boolean hasChance = false;
            for (int index = 0; index < count; index++) {
                Object value = method.invoke(target, Integer.valueOf(index));
                if (value instanceof Number) {
                    chances[index] = ((Number) value).intValue();
                    if (chances[index] >= 0 && chances[index] < 10000) {
                        hasChance = true;
                    }
                }
            }
            return hasChance ? chances : null;
        } catch (Throwable ignored) {
            return null;
        }
    }

    private String firstOutputName(GTRecipe recipe) {
        if (recipe.mOutputs != null) {
            for (ItemStack output : recipe.mOutputs) {
                String key = stackKey(output);
                if (key.length() > 0) return key;
            }
        }
        if (recipe.mFluidOutputs != null) {
            for (FluidStack output : recipe.mFluidOutputs) {
                if (output != null && output.getFluid() != null) return output.getFluid().getName();
            }
        }
        return "";
    }

    private int voltageTierForEu(long eut) {
        long value = Math.max(0L, Math.abs(eut));
        for (int tier = 0; tier < GT_VOLTAGES.length; tier++) {
            if (value <= GT_VOLTAGES[tier]) {
                return tier;
            }
        }
        return GT_VOLTAGES.length - 1;
    }

    private String craftingType(Object recipe) {
        if (recipe instanceof ShapedRecipes || recipe instanceof ShapedOreRecipe) return "shaped";
        if (recipe instanceof ShapelessRecipes || recipe instanceof ShapelessOreRecipe) return "shapeless";
        return recipe.getClass().getName();
    }

    private String thaumcraftType(String className) {
        String lower = className.toLowerCase(Locale.ROOT);
        if (lower.contains("infusion")) return "infusion";
        if (lower.contains("crucible")) return "crucible";
        if (lower.contains("arcane")) return "arcane";
        return "thaumcraft";
    }

    private boolean looksLikeCropCard(Object value) {
        String className = value.getClass().getName().toLowerCase(Locale.ROOT);
        return className.contains("crop") && (hasMethod(value, "tier") || hasMethod(value, "getId") || hasMethod(value, "name"));
    }

    private boolean hasMethod(Object target, String methodName) {
        for (Method method : target.getClass().getMethods()) {
            if (method.getName().equals(methodName) && method.getParameterTypes().length == 0) {
                return true;
            }
        }
        return false;
    }

    private Object firstObject(Object target, String... names) {
        for (String name : names) {
            Object value = invokeBest(target, name, new Object[0]);
            if (value != null) {
                return value;
            }
            value = readField(target, name);
            if (value != null) {
                return value;
            }
        }
        return null;
    }

    private String firstString(Object target, String... names) {
        Object value = firstObject(target, names);
        return value == null ? null : String.valueOf(value);
    }

    private Number firstNumber(Object target, String... names) {
        return asNumber(firstObject(target, names));
    }

    private Object invokeBest(Object target, String methodName, Object[] args) {
        if (target == null || methodName == null) {
            return null;
        }
        for (Method method : target.getClass().getMethods()) {
            if (!method.getName().equals(methodName) || method.getParameterTypes().length != args.length) {
                continue;
            }
            try {
                return method.invoke(target, args);
            } catch (Throwable ignored) {
            }
        }
        return null;
    }

    private String invokeString(Object target, String methodName) {
        Object value = invokeBest(target, methodName, new Object[0]);
        return value == null ? null : String.valueOf(value);
    }

    private Object readField(Object target, String fieldName) {
        if (target == null) {
            return null;
        }
        Class<?> type = target.getClass();
        while (type != null) {
            try {
                Field field = type.getDeclaredField(fieldName);
                field.setAccessible(true);
                return field.get(target);
            } catch (Throwable ignored) {
                type = type.getSuperclass();
            }
        }
        return null;
    }

    private Object readStaticField(Class<?> type, String fieldName) throws Exception {
        Field field = type.getField(fieldName);
        field.setAccessible(true);
        return field.get(null);
    }

    private int readStaticInt(String className, String fieldName, int fallback) {
        try {
            Object value = readStaticField(Class.forName(className), fieldName);
            return value instanceof Number ? ((Number) value).intValue() : fallback;
        } catch (Throwable ignored) {
            return fallback;
        }
    }

    private Object defaultReturnValue(Class<?> type) {
        if (type == Boolean.TYPE) return Boolean.FALSE;
        if (type == Byte.TYPE) return Byte.valueOf((byte) 0);
        if (type == Short.TYPE) return Short.valueOf((short) 0);
        if (type == Integer.TYPE) return Integer.valueOf(0);
        if (type == Long.TYPE) return Long.valueOf(0L);
        if (type == Float.TYPE) return Float.valueOf(0.0F);
        if (type == Double.TYPE) return Double.valueOf(0.0D);
        if (type == Character.TYPE) return Character.valueOf('\0');
        return null;
    }

    private Number asNumber(Object value) {
        return value instanceof Number ? (Number) value : null;
    }

    private double round(double value, int decimals) {
        double factor = Math.pow(10.0D, Math.max(0, decimals));
        return Math.round(value * factor) / factor;
    }

    private Iterable<?> iterable(Object value) {
        if (value == null) {
            return Collections.emptyList();
        }
        if (value instanceof Iterable) {
            return (Iterable<?>) value;
        }
        if (value instanceof Map) {
            return ((Map<?, ?>) value).entrySet();
        }
        if (value.getClass().isArray()) {
            List<Object> out = new ArrayList<Object>();
            int length = Array.getLength(value);
            for (int index = 0; index < length; index++) {
                out.add(Array.get(value, index));
            }
            return out;
        }
        return Collections.singletonList(value);
    }

    private List<?> listFrom(Object value) {
        List<Object> out = new ArrayList<Object>();
        for (Object entry : iterable(value)) {
            out.add(entry);
        }
        return out;
    }

    private List<?> listField(Object target, String fieldName) {
        Object value = readField(target, fieldName);
        return listFrom(value);
    }

    private int readIntField(Object target, String fieldName) {
        Object value = readField(target, fieldName);
        return value instanceof Number ? ((Number) value).intValue() : 0;
    }

    private void putIfPresent(Map<String, Object> target, String key, Object value) {
        if (value == null) {
            return;
        }
        if (value instanceof Collection && ((Collection<?>) value).isEmpty()) {
            return;
        }
        target.put(key, value);
    }

    private Map<String, Object> domain(String id) {
        Map<String, Object> domain = map();
        domain.put("id", id);
        return domain;
    }

    private Map<String, Object> adapter(
        String id,
        String status,
        boolean detected,
        int subjectCount,
        int recipeCount,
        long started,
        String warning
    ) {
        Map<String, Object> adapter = map();
        adapter.put("id", id);
        adapter.put("status", status);
        adapter.put("detected", Boolean.valueOf(detected));
        adapter.put("subjectCount", Integer.valueOf(subjectCount));
        adapter.put("recipeCount", Integer.valueOf(recipeCount));
        adapter.put("durationMillis", Long.valueOf(System.currentTimeMillis() - started));
        if (warning != null && warning.length() > 0) {
            adapter.put("warnings", Collections.singletonList(warning));
        }
        return adapter;
    }

    private List<String> loadedMods() {
        List<String> mods = new ArrayList<String>();
        for (Object modContainer : Loader.instance().getModList()) {
            Object value = invokeBest(modContainer, "getModId", new Object[0]);
            if (value != null) {
                mods.add(String.valueOf(value));
            }
        }
        Collections.sort(mods);
        return mods;
    }

    private int countRecipes(List<Map<String, Object>> domains) {
        int count = 0;
        for (Map<String, Object> domain : domains) {
            Object recipeMaps = domain.get("recipeMaps");
            for (Object recipeMap : iterable(recipeMaps)) {
                Object recipes = recipeMap instanceof Map ? ((Map<?, ?>) recipeMap).get("recipes") : null;
                for (Object ignored : iterable(recipes)) {
                    count++;
                }
            }
            for (String key : Arrays.asList("recipes", "species", "crops")) {
                for (Object ignored : iterable(domain.get(key))) {
                    count++;
                }
            }
        }
        return count;
    }

    private boolean isClassPresent(String className) {
        try {
            Class.forName(className);
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private String displayName(ItemStack stack) {
        try {
            return stack.getDisplayName();
        } catch (Throwable ignored) {
            return stackKey(stack);
        }
    }

    private String stackKey(ItemStack stack) {
        if (stack == null || stack.getItem() == null) {
            return "";
        }
        String registryId = String.valueOf(Item.itemRegistry.getNameForObject(stack.getItem()));
        return registryId + "@" + stack.getItemDamage() + "x" + stack.stackSize;
    }

    private String modId(String registryId) {
        int separator = registryId.indexOf(':');
        return separator > 0 ? registryId.substring(0, separator) : null;
    }

    private String itemResourceId(String registryId, int meta) {
        String id = canonicalRegistryId(registryId);
        return meta == 0 ? id : id + "@" + meta;
    }

    private String canonicalRegistryId(String registryId) {
        String normalized = safeString(registryId).trim();
        int separator = normalized.indexOf(':');
        if (separator < 0) {
            return normalized.toLowerCase(Locale.ROOT);
        }
        String domain = normalized.substring(0, separator).toLowerCase(Locale.ROOT);
        String path = normalized.substring(separator + 1).toLowerCase(Locale.ROOT);
        return domain + ":" + path;
    }

    private String sha1(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-1");
            byte[] data = digest.digest(value.getBytes("UTF-8"));
            StringBuilder builder = new StringBuilder();
            for (byte b : data) {
                builder.append(String.format("%02x", Byte.valueOf(b)));
            }
            return builder.toString();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private String safeTimestamp(String value) {
        return value.replaceAll("[^0-9T]", "").replace("T", "-");
    }

    private String isoNow() {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date());
    }

    private String safeString(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    private String join(List<String> values, String separator) {
        StringBuilder builder = new StringBuilder();
        for (String value : values) {
            if (builder.length() > 0) {
                builder.append(separator);
            }
            builder.append(value);
        }
        return builder.toString();
    }

    private Map<String, Object> map() {
        return new LinkedHashMap<String, Object>();
    }

    private static final class HeatingCoilTier {
        final String key;
        final String label;
        final int heat;
        final int coilTier;

        HeatingCoilTier(String key, String label, int heat, int coilTier) {
            this.key = key;
            this.label = label;
            this.heat = heat;
            this.coilTier = coilTier;
        }
    }

    private static final class VariantProfile {
        final boolean perfectOc;
        final boolean heatOc;
        final boolean heatDiscount;
        final int recipeHeat;
        final int machineHeat;
        final double durationModifier;
        final double eutDiscount;

        VariantProfile(
            boolean perfectOc,
            boolean heatOc,
            boolean heatDiscount,
            int recipeHeat,
            int machineHeat,
            double durationModifier,
            double eutDiscount
        ) {
            this.perfectOc = perfectOc;
            this.heatOc = heatOc;
            this.heatDiscount = heatDiscount;
            this.recipeHeat = recipeHeat;
            this.machineHeat = machineHeat;
            this.durationModifier = durationModifier;
            this.eutDiscount = eutDiscount;
        }

        static VariantProfile standard() {
            return new VariantProfile(false, false, false, -1, -1, 0.0D, 0.0D);
        }

        static VariantProfile perfectOc() {
            return new VariantProfile(true, false, false, -1, -1, 0.0D, 0.0D);
        }

        static VariantProfile ebfHeat(int recipeHeat, int machineHeat) {
            return new VariantProfile(false, true, true, recipeHeat, machineHeat, 0.0D, 0.0D);
        }

        static VariantProfile pyrolyse(int coilTier) {
            return new VariantProfile(false, false, false, -1, -1, 2.0D / (1.0D + coilTier), 0.0D);
        }

        static VariantProfile oilCracker(int coilTier) {
            double discount = 1.0D - Math.min(0.1D * (coilTier + 1), 0.5D);
            return new VariantProfile(false, false, false, -1, -1, 0.0D, discount);
        }
    }

    public static final class ExportResult {
        public final String outputFile;
        public final int recipeCount;
        public final int adapterCount;

        ExportResult(String outputFile, int recipeCount, int adapterCount) {
            this.outputFile = outputFile;
            this.recipeCount = recipeCount;
            this.adapterCount = adapterCount;
        }
    }
}
