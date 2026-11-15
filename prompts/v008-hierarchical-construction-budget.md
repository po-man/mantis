You are an expert computational geometry engine, minimalist character/object illustrator, and 2D motion-rigging artist. Your task is to analyze the provided image, isolate the primary foreground subject, and reconstruct it as a clean, static, multi-layered Scalable Vector Graphics (SVG) file in a modern, appealing, lineless cartoon style engineered for downstream skeletal rigging, mesh deformation, and external 2.5D parallax animation.

Do NOT include any animation tags (`<animate>`, CSS keyframes, CSS transitions, scripts, or the `transform` attribute). Do NOT embed raster `<image>` tags. Your sole output is a structurally pristine, depth-annotated static vector illustration. All motion is produced by an external parallax rig that reads the depth metadata described below.

Follow these strict operational parameters:

1. SUBJECT ISOLATION & FEATURE EXAGGERATION
- **Background Removal:** Ignore all background scenery, environmental clutter, and cast ground shadows. Reconstruct only the primary foreground subject.
- **Key Feature Capture & Magnification:** Identify the 2 to 3 most iconic, recognizable features of the subject (such as expressive eyes, ears, snout, headwear, petals, lenses, or signature accessories) and deliberately **magnify and stylize** their proportions for strong cartoon appeal while preserving unmistakable likeness.

2. CANVAS & PURE PRESENTATION-ATTRIBUTE STYLING
- Map the stylized subject proportionally onto a normalized 1024x1024 coordinate grid. The root SVG element must be exact:
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="100%" height="100%">`
- **Presentation Attributes Only:** Style every element strictly using explicit XML presentation attributes (`fill="#HEXCODE"`, `stroke="#HEXCODE"`, `stroke-width="..."`, `stroke-linecap="round"`, `stroke-linejoin="round"`, `opacity="..."`). Do NOT use `<style>` blocks, CSS classes, inline `style="..."` strings, gradients (`<linearGradient>`, `<radialGradient>`), SVG `<filter>` tags, CSS transforms, or the SVG `transform` attribute.

3. HIERARCHICAL CONSTRUCTION BUDGET & ORGANIC SHAPE LANGUAGE
Construct the illustration strictly from **macro-to-micro** as a clean semantic tree. Never shatter a continuous body part or object into irrelevant jigsaw fragments; build large unified volumes first and nest details progressively inside them using these strict per-level budgets:
- **Level 1 — Primary Macro Components (4 to 8 total):** Divide the entire subject into only **4 to 8 top-level structural parts** (for example: `torso`, `head`, `headwear`, `left-arm`, `right-arm`, `tail`). Each Level 1 group is anchored by one unified base silhouette primitive.
- **Level 2 — Direct Sub-Components & Surface Layers (2 to 4 per Level 1 part):** Inside each Level 1 part, include only **2 to 4 direct child primitives or sub-groups** (for example, inside `head`: base skin silhouette, cast shadow band, `left-eye` group, and `right-eye` group).
- **Level 3 — Secondary Details (1 to 3 per Level 2 element):** Inside each Level 2 element, include only **1 to 3 child primitives** (for example, inside `left-eye`: sclera base, eyelid shadow, and `iris-assembly` group).
- **Level 4+ — Fine Accents (1 to 2 per Level 3 element):** Any deeper nested accent (such as a pupil and specular catchlight inside an iris) must be limited to **1 to 2 primitives** per parent.
- **Organic Bezier Paths Over Pill/Ellipse Primitives:** Minimize the use of capsule/pill rectangles (`<rect rx="...">`) and generic `<ellipse>` shapes—**especially for limbs, torsos, tails, and organic contours**. Sculpt all limbs and main body silhouettes as **simple, graceful, low-anchor cubic Bezier `<path>` shapes** (`C`, `S`) with natural organic taper and smooth $G^1$ curvature so they look hand-crafted rather than built from stiff geometric tubes. Reserve `<circle>` strictly for true circular elements (pupils, catchlights, buttons, circular joints) and `<rect>` strictly for genuinely rectangular man-made objects.

4. STRICTLY PLAIN COLORS & MULTI-LAYERED VOLUMETRIC CONSTRUCTION
Achieve rich, tactile 3D volume using **100% solid, plain colors** (zero gradients) and **multi-layered surface construction across ALL major parts** of the object (torso, head, headwear, petals, casing, limbs, and eyes if present):
- **Strictly Borderless Filled Areas:** Every filled shape (`<path>`, `<circle>`, `<rect>`) MUST have `stroke="none"`. Never outline filled shapes; separate forms through contrasting flat color values and crisp silhouettes. Use rich tinted off-whites (e.g., `#F4F6FA`) and deep off-blacks (e.g., `#161421`) rather than harsh pure `#FFFFFF` or `#000000` for base fills, reserving pure `#FFFFFF` strictly for small specular catchlights.
- **Multi-Layered Volume Stack (Applied to Every Primary Part):** Never leave major shapes as a single flat fill. Construct each primary component as a clipped multi-layer lighting stack (`<g id="part-surface" clip-path="url(#clip-part)">`) obeying the Level 2/3 primitive budget:
  1. **Base Silhouette (`z` = part base):** The foundational flat color plane that also defines `<clipPath id="clip-part">`.
  2. **Cast & Form Shadow Layer (`z` = base + `0.02` to `0.05`):** Oversized clipped Bezier shapes or stepped darker tonal bands representing ambient occlusion, core shading, or cast shadows from overhanging elements (such as a shadow under a cap brim, collar, petal, or upper eyelid).
  3. **Secondary Surface / Mid-Tone Layer (`z` = base + `0.04` to `0.08`):** Distinct internal color blocks, markings, or cropped irises clipped cleanly inside the parent silhouette.
  4. **Oversized Specular & Rim Highlight Layer (`z` = base + `0.08` to `0.15`):** Oversized smooth `<path>` or `<circle>` primitives (with lighter/brighter flat fills) placed inside the parent's `<clipPath>` so the mask slices them into sleek crescent rim lights, glossy surface sheens, or dual asymmetric eye catchlights (one large primary glint + one tiny bounce spark).
- **Keep Boundary & Upper-Lash Strokes Outside `<clipPath>`:** Open, non-filled linear details—such as an upper eyelash line, eyebrow, whiskers, thin tail, stem, or crisp crease—must be drawn as open `<path>` elements with `fill="none"`, bold intentional `stroke-width`, and `stroke-linecap="round"`. Always place framing boundary strokes (especially upper eyelashes over a sclera) **outside** the `<clipPath>` group as a later sibling inside the parent part `<g>` so the clip mask never slices the stroke's thickness in half.

5. DEPTH STAGING FOR EXTERNAL 2.5D PARALLAX
The SVG will be driven by an external parallax rig generated from the depth metadata below. The SVG itself must remain completely static. Every element that should move independently must declare its depth:
- **`data-z` (required on animated elements):** Add `data-z="<0.00–1.00>"` to every semantic `<g>` and to every standalone primitive that should move independently (including internal shadow, mid-tone, and highlight primitives). `0.00` is the farthest layer, `0.50` is the neutral mid-ground, and `1.00` is the nearest foreground. Elements without `data-z` inherit their nearest ancestor's depth and move rigidly with it.
- **Depth spread:** Use at least three distinct depth bands and a total spread of at least `0.35` between the farthest and nearest animated element. Never collapse everything around `0.50`.
- **Suggested bands:** rear limbs/tail/rear accessories `0.10–0.25`; torso/base body `0.30–0.42`; head/primary housing `0.45–0.60`; ears/hair/headwear `0.55–0.70`; eyes/lenses `0.65–0.80`; muzzle/snout/front controls `0.70–0.85`; front limbs/paws `0.60–0.78`; internal shadows/highlights/unclipped lashes `parent z + 0.02 to +0.18`.
- **Painter's order equals depth order:** Render farthest elements first. Within any parent, later siblings must have a `z` greater than or equal to earlier siblings. Never paint a far element over a near one.
- **`data-pivot` (required with `data-z`):** Add `data-pivot="x,y"` to every element that carries `data-z`, using the element's visual center or joint center in the `1024x1024` coordinate space.
- **Independent masked highlights & shadows:** Put `clip-path="url(#clip-...)"` on the inner surface `<g>` that wraps the base shape and its oversized shadow/highlight primitives—**never directly on the highlight/shadow primitive**, and **never wrapping external boundary/lash strokes**. Give each shadow/highlight primitive its own `data-z` slightly above the parent's `z` and its own `data-pivot` so the mask slices the moving highlight/shadow into a traveling sheen.
- **Optional motion gain:** Add `data-parallax="<number>"` (default `1.0`) sparingly for focal features that should lead motion (e.g., `data-parallax="1.3"` on irises/pupils).
- **No `transform` attributes:** Do not use the `transform` attribute anywhere in the SVG. Express all placement and orientation directly through coordinates and path geometry.
- **Stable ids:** Every element with `data-z` must have a unique, descriptive, kebab-case `id` (`head`, `head-surface`, `head-rim-light`, `left-upper-lash`).

6. SMOOTH BEZIER CONTOURS & RIG-READY KINEMATIC ARCHITECTURE
- **Smooth Bezier Main Contours & Limbs:** Sculpt all primary contours and limbs using ultra-smooth, low-anchor cubic Bezier curves (`C`, `S`) with collinear $G^1$ tangent continuity across smooth nodes—never stiff pill rectangles or generic ellipses.
- **Parent-Child Kinematic Nesting:** Group logical components into semantic `<g id="part-name">` containers and nest dependent child parts inside their parent groups (e.g., `<g id="torso">` containing `<g id="head">` and `<g id="arm">`).
- **Articulated Joint Separation & Full Occlusion Completion:** Separate movable parts at their joints with smooth rounded overlap caps. Always draw the **entire** underlying base shape behind any foreground occluder so future parallax or rotation never exposes gaps.

7. GEOMETRIC FIDELITY: STRICT STRAIGHTNESS VS. TRUE CURVATURE
- **Rectilinear Edges (`L`, `H`, `V`, `<rect>`):** Draw physically straight edges with exact straight-line commands or rectangles—never wobbly Bezier curves.
- **Curvilinear Edges (`C`, `S`, `Q`, `<circle>`):** Draw physically curved contours with smooth Bezier curves or exact circles, placing sharp corner vertices strictly where genuine creases or corners exist.

8. PRE-GENERATION HIERARCHICAL & PRIMITIVE BUDGET PLAN
Before writing any SVG markup, plan your construction inside `<reasoning>` tags. Include:
- **Subject Identification & Feature Exaggeration:** Confirm the isolated subject, excluded background, and magnified signature features.
- **Hierarchical Construction Tree (Strict Per-Level Budget Check):** Lay out an indented tree showing:
  - **Level 1** macro parts (confirming **4–8** total),
  - **Level 2** sub-elements inside each Level 1 part (confirming **2–4** per parent),
  - **Level 3** details inside each Level 2 element (confirming **1–3** per parent),
  - **Level 4+** accents (confirming **1–2** per parent),
  and verify that limbs and organic contours use smooth cubic Bezier `<path>` shapes rather than pill `<rect>`s or `<ellipse>`s.
- **Plain Color & Multi-Layer Lighting Plan:** List the flat hex palette and detail how each major volume is layered (base fill, cast/form shadow, mid-tone, oversized masked highlight, and any unclipped boundary/lash strokes placed outside `<clipPath>`).
- **Edge Classification & Kinematic Hierarchy:** Specify rectilinear vs. curvilinear parts, exact `data-pivot="x,y"` coordinates, full occlusion completions, and `<clipPath>` definitions.
- **Depth & Parallax Plan:** List every `data-z` element in ascending paint order with its `z` value and `data-pivot`, confirming at least three distinct depth bands with a total spread of at least `0.35`.

9. FINAL OUTPUT
Immediately after closing the `</reasoning>` tag, output the complete, valid SVG code enclosed in an ```xml codeblock. Do not include any text, notes, or explanations after the codeblock.

Execute the task now.