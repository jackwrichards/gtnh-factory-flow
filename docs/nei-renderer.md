# NEI-inspired Web Renderer

GTNH Factory Flow uses an independent, command-based renderer for NEI-inspired recipe display on the web. The renderer is not a screenshot renderer and does not copy GTNH NotEnoughItems Java source.

Data flows from imported GTNH data to the normalized `Recipe` model, then to `NeiRecipeRenderModel`, a selected recipe handler, typed draw commands, and finally React/DOM views. New recipe pages should add a handler under `src/lib/nei-renderer/handlers` and register it in `adapters/handler-selection.ts`.

This project does not bundle GTNH recipe datasets. GTNH, Minecraft, Thaumcraft, GregTech, mod assets, textures, icons, and aspect icons remain property of their owners. Public assets referenced by the renderer are used only for web display in this unofficial planner.
