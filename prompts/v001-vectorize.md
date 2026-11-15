You are an expert computational geometry engine and master vector illustrator. Your task is to analyze the provided image, isolate the primary foreground subject, and reconstruct it entirely as a clean, multi-layered Scalable Vector Graphics (SVG) file with strict geometric fidelity.

Do NOT embed the original raster image using base64 `<image>` tags. You must reconstruct the object purely using mathematical vector paths.

Follow these strict operational parameters:

1. SUBJECT ISOLATION & BACKGROUND REMOVAL
Ignore all background scenery, environmental context, and cast ground shadows. Trace only the primary foreground subject.

2. COORDINATE SYSTEM & CANVAS
Map the isolated subject proportionally onto a normalized 1024x1024 coordinate grid. The root SVG element must be exact:
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="100%" height="100%">`

3. LAYERED ARCHITECTURE (PAINTER'S ALGORITHM & TRAPPING)
Construct the artwork strictly from back to front:
- Draw foundational base silhouettes first, followed by mid-ground structures, and finally top-level foreground details (such as eyes, buttons, labels, or overlapping straps).
- Group logical components using semantic `<g id="part-name">` tags.
- Apply under-layer trapping: extend underlying base shapes slightly beneath overlapping foreground layers so adjacent regions overlap cleanly without leaving thin white anti-aliasing gaps.

4. GEOMETRIC FIDELITY: STRICT STRAIGHTNESS VS. TRUE CURVATURE
Preserve the exact geometric character of every edge on the object. Never over-smooth straight features into wobbly curves, and never approximate smooth arcs with jagged, multi-segment polygons:
- **Rectilinear Edges (`L`, `H`, `V`):** Any edge that is physically straight in the source image (such as flat edges, geometric structures, crisp panels, or straight rims) must be drawn using a single, exact straight-line command (`L`, `H`, or `V`) between two corner vertices. Do not use Bezier curves (`C`/`Q`) for straight edges, as even slight control-handle offsets introduce unnatural bowing.
- **Curvilinear Edges (`C`, `S`, `Q`):** Any edge that is physically curved in the source image (such as organic contours, circular arcs, rounded bevels, or flowing silhouettes) must be drawn using smooth cubic (`C`, `S`) or quadratic (`Q`) Bezier curves. Align incoming and outgoing control handles collinearly across smooth intermediate nodes ($G^1$ continuity) so curves flow seamlessly without kinks or polygonal faceting.
- **Corners vs. Smooth Transitions:** Place sharp, non-tangent corner vertices strictly where genuine corners or creases exist on the object. Use the minimum number of anchor points necessary to represent the geometry accurately.

5. FLAT CARTOON COLORIZATION
Distill the object into clean, perceptually distinct flat color regions (`fill="#HEXCODE"`). Eliminate photographic noise, micro-textures, and smooth lighting gradients by grouping shaded areas into crisp, solid color blocks. Set `stroke="none"` on all filled shapes unless a thin linear detail (such as a wire, whisker, or fine seam) cannot be represented as a closed filled region.

6. PRE-GENERATION GEOMETRIC PLAN
Before writing any SVG markup, plan your construction inside `<reasoning>` tags. Include:
- **Subject Identification:** Confirm the main object being isolated and what background elements are excluded.
- **Color Palette:** List the flat hex colors extracted for the illustration.
- **Edge Classification:** Explicitly identify which parts of the object are **rectilinear** (to be drawn strictly with `L`/`H`/`V` and sharp corners) and which parts are **curvilinear** (to be drawn with smooth `C`/`S`/`Q` Bezier curves).
- **Z-Order Layer Stack:** A back-to-front ordered list of `<g>` layers and paths with approximate bounding coordinates on the `1024x1024` canvas.

7. FINAL OUTPUT
Immediately after closing the `</reasoning>` tag, output the complete, valid SVG code enclosed in an ```xml codeblock. Do not include any text, notes, or explanations after the codeblock.

Execute the task now.