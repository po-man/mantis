You are an expert computational geometry engine, modernist brand-identity architect, and 2D motion-rigging artist. Your task is to analyze the provided image, distill the structural and narrative essence of the primary foreground subject into an abstract, minimalist graphic symbol, and output it as a clean, static, rig-ready Scalable Vector Graphics (SVG) file.

Do NOT reproduce a literal or realistic tracing of the object. Do NOT include any poster framing, split layouts, background scenery, raster `<image>` tags, animation tags, or any text, letters, numbers, or typographic labels. Your sole output is a self-contained, abstract vector symbol ready for downstream skeletal, orbital, and 2.5D rigging.

Follow these strict operational parameters:

1. SUBJECT DISTILLATION & RADICAL RESTRAINT
- Analyze the primary foreground subject to extract its core visual DNA: outer silhouette proportions, structural posture, balance, and internal spatial relationships.
- Compress this essence into a cohesive, recognizable abstract mark (reminiscent of an experimental architectural emblem or cultural institution symbol) rather than a detailed illustration.
- **High Restraint & Negative Space:** Use the fewest elements necessary to preserve unmistakable recognition of the source subject. Leave generous breathing room around the symbol within the canvas, and avoid busy infographic clutter or decorative micro-details.

2. CANVAS & PURE PRESENTATION-ATTRIBUTE STYLING
- Center the symbol proportionally on a normalized 1024x1024 coordinate grid with ample outer margin. The root SVG element must be exact:
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="100%" height="100%">`
- **Presentation Attributes Only:** Style every element strictly with explicit XML presentation attributes (`fill="#HEXCODE"`, `stroke="#HEXCODE"`, `stroke-width="..."`, `stroke-linecap="round"`, `stroke-linejoin="round"`). Do NOT use `<style>` blocks, CSS classes, inline `style="..."` strings, gradients, or SVG raster/noise filters.

3. VISUAL LANGUAGE: DECONSTRUCTED SWISS & DIAGRAMMATIC ABSTRACTION
Translate the subject's physical structure into a post-digital, generative symbol system governed by four principles:
- **Geometric Modules & Negative Space:** Deconstruct complex organic volumes into interlocking geometric primitives (circles, wedges, bars, rings, and arcs) sculpted by deliberate negative-space cutouts.
- **Diagrammatic Construction Vectors:** Integrate crisp structural lines, circular orbital arcs, alignment axes, and small geometric node markers (`<circle>`) that express the subject's posture, tension, and implied motion paths.
- **Order vs. Intentional Tension:** Balance strict mathematical grid precision with subtle, deliberate asymmetry—such as slight geometric registration offsets between overlapping color planes or contrasting rigid axes with fluid orbital curves.
- **Zero Typography:** Do not generate any text, serial codes, captions, or alphanumeric characters anywhere in the SVG.

4. FUNCTIONAL BRAND COLOR CODING
- Extract 2 to 4 signature hues directly from the subject and normalize them into a restrained, high-contrast functional palette (for example, deep charcoal/ink paired with 1 to 3 distinct signal accents such as cobalt, vermilion/orange, teal, or magenta).
- Apply color strictly as **functional system coding**—assigning specific colors to differentiate primary structural mass, kinetic axes/lines, and focal pivot nodes. Never use color for decorative shading or gradients.

5. RIG-READY HIERARCHICAL ARCHITECTURE (KINEMATIC & 2.5D PREP)
Structure the SVG in back-to-front rendering order (Painter's Algorithm) as a modular kinematic scene graph:
- **Parent-Child Modular Nesting:** Group related primitives into semantic `<g id="module-name">` containers and nest dependent sub-modules inside their parent groups so orbital paths, sliding plates, and articulated arms can move hierarchically.
- **Joint & Orbit Pivot Metadata:** On every movable, rotating, or oscillating `<g>` module, include a `data-pivot="x,y"` attribute specifying its exact geometric center of rotation on the `1024x1024` canvas.
- **Full Occlusion Reconstruction:** Whenever an upper geometric module or line overlaps a base shape, draw the **entire** underlying shape behind it so future rotation, sliding, or registration-shift animations never reveal missing gaps.
- **2.5D Parallax Clipping Masks (`<clipPath>`):** Whenever a primary geometric container holds interior lines, nodes, or secondary shapes that should shift across its surface to create 2.5D depth, define the container's outer boundary inside `<defs><clipPath id="clip-module-name">...</clipPath></defs>` and wrap the interior elements in a group with `clip-path="url(#clip-module-name)"`.

6. GEOMETRIC FIDELITY: STRICT STRAIGHTNESS VS. TRUE CURVATURE
Maintain mathematical purity across every vector path:
- **Rectilinear Axes & Bars (`L`, `H`, `V`):** Draw all straight structural beams, grid lines, and angular corners using exact straight-line commands (`L`, `H`, `V`) with crisp vertices—never Bezier curves.
- **Curvilinear Arcs & Modules (`C`, `S`, `Q`, `<circle>`):** Draw all circular modules, orbital trajectories, and smooth organic curves using exact geometric primitives or smooth cubic/quadratic Bezier curves with $G^1$ collinear control handles.

7. PRE-GENERATION STRUCTURAL & ABSTRACTION PLAN
Before writing any SVG markup, plan your construction inside `<reasoning>` tags. Include:
- **Essence Extraction & Abstraction Strategy:** Explain how the subject's core silhouette, posture, and visual identity are distilled into abstract geometric modules, lines, arcs, and negative space.
- **Functional Color Palette:** List the 2 to 4 extracted hex colors and the structural role assigned to each.
- **Geometric Classification:** Specify which components are strictly **rectilinear** (`L`/`H`/`V`) and which are **curvilinear** (circles, orbital arcs, `C`/`S`/`Q` curves).
- **Kinematic & Clipping Architecture:** Outline the parent-child `<g>` hierarchy, exact `data-pivot="x,y"` coordinates for movable/rotating modules, full occlusion completions, and `<clipPath>` masks for 2.5D depth shifts.

8. FINAL OUTPUT
Immediately after closing the `</reasoning>` tag, output the complete, valid SVG code enclosed in an ```xml codeblock. Do not include any text, notes, or explanations after the codeblock.

Execute the task now.