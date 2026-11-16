You are an expert vector illustrator and 2D rigging artist. Analyze the provided image, isolate the primary foreground subject, and rebuild it as ONE static, multi-layered, depth-annotated SVG in a modern lineless flat-cartoon style, engineered for an external 2.5D rig (cursor parallax plus autonomous idle motion). All motion is produced by the rig from the metadata below; the SVG itself stays static.

BANNED EVERYWHERE: `<animate>`, CSS keyframes/transitions, `<script>`, `<style>`, inline `style="..."`, the `transform` attribute, raster `<image>`, gradients, `<filter>`, `class`, `@import`, external `href` or `url(...)`. Use XML presentation attributes only (`fill`, `stroke`, `stroke-width`, `stroke-linecap`, `stroke-linejoin`, `opacity`).

1. SUBJECT & FEATURE EXAGGERATION
- Drop background scenery, clutter and cast ground shadows; reconstruct the subject only.
- Magnify the 2–3 most iconic features (eyes, ears, snout, headwear, petals, lenses, accessories) for cartoon appeal while preserving likeness, silhouette landmarks, pose and gaze. **Pose fidelity outranks magnification and symmetry.**
- Never invent hidden features. With no visible eyes (back view, opaque eyewear, fur, object), draw none.
- **Completeness:** draw every visible part — each limb in its real count and pose, ears, tail, headwear and every facial feature the source shows. An omission is as wrong as an invention.

2. CANVAS
Root element must be exactly:
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="100%" height="100%">`
Map the stylized subject proportionally into that 1024×1024 grid.

3. STRUCTURE & BUDGET (macro → micro)
- **Level 1 (4–8 parts):** top-level structural parts (`torso`, `head`, `headwear`, `left-arm`, `tail`…), each anchored by one unified base silhouette. They are flat siblings under a single root wrapper `<g id="subject" data-z="0.5" data-pivot="512,512">`; never nest one Level 1 part inside another. Kinematics come from sockets/anchors (§5), not from DOM nesting.
- **Level 2 (2–4 per Level 1):** direct children (base silhouette, shadow band, `left-eye` group, `mouth` group). A head showing two eyes plus nose and mouth may carry up to 6.
- **Level 3 (1–3 per Level 2)**, **Level 4+ (1–2 per Level 3)**.
- Never shatter a continuous body part into fragments, and never hide, merge or symmetrize a visible feature to satisfy a budget.
- **Organic contours:** build limbs, torsos and tails from simple low-anchor cubic Béziers (`C`, `S`) with natural taper and G1 continuity. Reserve `<ellipse>`/`<rect rx>` for genuinely geometric objects, `<rect>` for man-made rectangles and `<circle>` for true circles (pupils, catchlights, buttons, joints). Draw real straight edges with `L`/`H`/`V`; put sharp vertices only where real creases exist.
- **Occlusion completion:** always draw the complete underlying base shape behind a foreground occluder, separated at joints with smooth rounded overlap caps, so rig motion never exposes a gap.

4. COLOR & VOLUME
- 100% solid flat fills, zero gradients. Filled shapes carry `stroke="none"`; separation comes from value contrast and crisp silhouettes. Prefer tinted off-whites (`#F4F6FA`) and off-blacks (`#161421`) over `#FFFFFF`/`#000000`; reserve pure white for small catchlights.
- **Every primary part is a clipped lighting stack** `<g id="part-surface" clip-path="url(#clip-part)">` with, in ascending depth:
  1. base silhouette (defines `clip-part`),
  2. cast/form shadow, `z = base + 0.02` to `+0.05`,
  3. mid-tone, marking or cropped iris, `z = base + 0.04` to `+0.08`,
  4. oversized specular/rim highlight, `z = base + 0.08` to `+0.15`, sliced by the clip into crescents.
- **Boundary strokes stay outside the clip:** open non-filled details (brow, lip crease, whiskers, thin tail, stem) are open `<path fill="none">` with bold `stroke-width` and `stroke-linecap="round"`, placed after the clipped group as a sibling so the mask never halves the stroke.
- **Lashes are filled silhouettes, never strokes.** Each is a closed tapered `fill="<contrast tone>" stroke="none"` shape: starts on the outer 50–75% of the upper lid; longest outer tip protrudes 6–14 units past the eye silhouette at 15–45°; monotonic taper from a 4–8 unit root to a 0–2 unit tip; lash mass ≤55% of eye width; tip ≤45% of eye height; near-frontal eyes differ 10–20% (perspective dominates on a turned head); tone must contrast with the surface directly behind it. Pick ONE archetype from the source: **Solid Wing** (humans), **Tapered Spikes** 2–4 lobes (most animals), **Serrated Fringe** 3–5 teeth (woolly), **Mask Notch** 2–3 V-notches cut into a dark eye patch with no separate primitive (red panda, meerkat, raccoon), **Feather Lobe** (birds), **Soft Comb** (short-lashed). Tuck the root 3–6 units into the lid; keep it outside the eye `<clipPath>` and outside any glint/gloss/highlight subgroup, as a direct child of the eye group, with id `left-lash`/`right-lash` (`-1`, `-2` for lobes). Every visible eye carries one lash mass.

5. DEPTH, RIG METADATA & PAINT ORDER
- `data-z="0.00–1.00"` on every semantic `<g>` and every primitive that should move independently (internal shadow, mid-tone, highlight). `0.00` = farthest, `0.50` = neutral, `1.00` = nearest. Elements without `data-z` inherit the nearest ancestor's depth.
- `data-pivot="x,y"` in 1024-space on every element that carries `data-z`, at its visual or joint centre.
- Every `data-z` element needs a unique, descriptive, kebab-case `id`.
- Use at least three depth bands spanning at least `0.35`. Suggested: rear limbs/tail 0.10–0.25; torso 0.30–0.42; head 0.45–0.60; ears/hair/headwear 0.55–0.70; eye and mouth apertures 0.58–0.64; front limbs 0.62–0.78; surface shadows/highlights parent + 0.02 to 0.18; lashes inherit the eye group's z (+0.00 to 0.03).
- **Painter order equals depth order:** farthest first; within a parent, later siblings have z ≥ earlier siblings.
- **Level 1 joints:** the host declares `data-sockets="name:x,y name:x,y"` (names unique document-wide); the child declares `data-anchor="name"` with no coordinate, because the socket is authoritative, and its `data-pivot` must equal the joint. Exactly one anchor per Level 1 part except the structural core (`torso`/`body`/`base`); the graph is a tree with no cycles. Sockets live only on Level 1 parts, and Level 2+ never declares an anchor. Extend the child silhouette ~32 units past the joint into the host so swing never opens a crack; never butt parts edge-to-edge. Optional `data-weld="0.85–0.95"` for organic parts that keep a hint of slide.
- **Recessed interiors (eyes, open mouth):** the `<g clip-path>` aperture wrapper takes the facial-surface z, and interiors stack at strictly lower z in ascending order. Eyes: sclera 0.52, iris 0.54, pupil 0.56, upper-lid shadow 0.59 inside a 0.62 wrapper, with unclipped catchlights at 0.64. Mouth: throat 0.44, tongue 0.49, tongue highlight/teeth 0.52 inside a 0.58 wrapper, with lips/creases at 0.60 outside. Parallax then slides the aperture across the recessed interior. Aperture geometry always comes from the source pose, never from a frontal template.
- On convex volumes, put `clip-path` on the inner wrapper group — never on the highlight/shadow primitive, never over boundary strokes — and give each primitive its own z at parent + 0.02 to 0.15 so the mask slices a travelling sheen.
- Optional `data-parallax="<number>"` (default 1.0) for focal features only.

6. IDLE MOTION
`data-anim="<preset>"` plus optional `data-anim-period`, `data-anim-amplitude`, `data-anim-delay`. Every animated element also needs `data-z`, `data-pivot` and a stable id.

| Preset | Apply to | Channel | Amplitude | Period |
| --- | --- | --- | --- | --- |
| `breathe` | torso / body / chest | uniform scale | 2% | 3–5 s |
| `bob` | subject root, head, floating object | translate Y | 4–10 units | 2.5–4 s |
| `sway` | tail, hair, antenna, plant, hanging part, leg | rotate | 2–6° | 2.5–5 s |
| `blink` | eye group only | scale Y | 0.85–0.95 close | 3–7 s |
| `nod` | head | rotate | 1.5–4° | 3–6 s |
| `twitch` | ear, whisker, brow, paw, small appendage | rotate | 2–5° | 3–8 s |
| `wave` | arm, hand, paw, fin, wing | rotate | 5–12° | 1.5–3 s |
| `hop` | small animal / light object root | translate Y + squash | 6–20 units | 2–5 s |

Rules: exactly one primary (`breathe`/`bob`/`hop`) plus 0–2 secondary (`blink`/`sway`/`nod`/`twitch`/`wave`); at most 4 animated elements; one preset per element. `blink` only on eye groups meeting §7; `wave` only on a clearly free limb; `hop` only for small light subjects. Anchored parts may only rotate/scale, never `bob` or `hop`; only the root or an unanchored part translates. Total idle displacement under ~2% of the canvas (~20 units), and the t=0 pose equals the static pose with no baked offset. Do not animate mouth, nose or brow. Mapping: character/animal → `breathe` + `blink` + one of `sway`/`nod`/`twitch`/`wave`; small animal → `hop` + `blink` + `sway`; object → `breathe`/`bob` + `sway`/`twitch`; plant → `sway` + `twitch`.

7. EYES (whenever visible)
Eyes are organs seated in the head, not frontal symbols pasted on the face. Pose fidelity outranks magnification and symmetry.
- **Read the pose:** yaw bucket (frontal 0–15°, slight three-quarter 15–35°, three-quarter 35–55°, strong three-quarter 55–75°, profile 75–90°), plus pitch and roll. `left`/`right` always mean screen-left/screen-right.
- **Read the gaze:** define one screen-space gaze vector (at the camera, along the head direction, or off-screen) and apply it to every visible eye. Do not centre pupils by default.
- **Count sockets, draw only those:** exactly 0, 1 or 2 eye groups, plus a far-eye sliver only when the source shows one. At 15–35° the far eye is 65–85% of the near eye's width; at 35–55° it is 40–70% with its inner corner tucked behind the nose bridge; at 55–75° it is a ≤30% sliver or omitted; at 75–90° draw the near eye only. Never mirror an eye onto the far side of a profile head, and never draw two equal mirrored eyes on a turned head. Lateral-eyed animals follow the source's actual visibility.
- **Aperture:** a closed cubic-Bézier `<path>` with 4–6 anchors traced from the source (inner corner, outer corner, upper-lid peak as a fraction of aperture width, lower-lid trough, canthal tilt) ending in `Z`, used as the `<clipPath>` boundary. Never an open stroked outline, and never a default `<circle>`/`<ellipse>`/`<rect>` unless the source contour is genuinely circular. A dark eye patch is a surface marking: draw the filled patch first, then the aperture, iris and catchlight on top.
- **Iris and pupil:** offset both pupils along the gaze vector by 15–40% of aperture width when off-axis; compress a strongly turned iris into an ellipse (10–25% along the gaze axis); let the lids clip the iris rather than shrinking it.
- **Occlusion:** honour hooded lids, blinks, fur and nose-bridge occlusion; never open a partially closed eye and never draw a far eye through the bridge. A visible iris, pupil or catchlight means an open aperture — never a closed slit or a solid dark patch. Eyewear means the eyes stay hidden.
- **Catchlights and lashes:** keep catchlights on the lit side and scale the far-eye catchlight down; point each lash flick away from the nose along that eye's projected outer corner. The 10–20% lash asymmetry rule applies to near-frontal eyes only.
- **Magnify without re-orienting:** scaling the eye groups is allowed; aperture landmarks, canthal tilt, gaze offset and visibility are not.
- **Blink Mask Contract (every visible eye):** one self-contained `<g id="left-eye">` / `<g id="right-eye">` that carries the aperture clip (`clip-path="url(#clip-left-eye)"`) and contains the clipped interior (sclera, iris, pupil, lid shadow), the unclipped catchlights and the filled lash mass. The clip may sit on the group or an inner wrapper, never on an ancestor outside the blink target. Exclude brow, eye patch, muzzle and surrounding face. `data-pivot` is the aperture centre. No separate skin-coloured eyelid. The group carries `data-anim="blink"`.

8. SELF-CHECK BEFORE WRITING THE SVG (≤8 short lines)
1. Subject, every visible part (limbs, ears, tail, accessories) and the 2–3 magnified features.
2. Yaw bucket, pitch, roll, gaze vector.
3. Per eye: id → visibility → aperture bbox → iris offset → catchlight side.
4. Level 1 parts with anchors and sockets; tree, no cycles.
5. z bands in paint order with pivots; spread ≥0.35.
6. Animated elements and their presets.
7. Lash archetype per visible eye.
8. Confirm none of the banned constructs appears.

9. OUTPUT
Emit one ```xml block containing the complete SVG, and nothing before or after it.
