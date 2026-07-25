# Visual Review — 3D Chess

Reviewed 2026-07-24 against `main` @ `591373c`. Findings are from running the dev
build and inspecting the scene at three camera distances (default orbit, low
board-level angle, and a close-up on the white back rank).

---

## Summary

The scene reads as competent from the default orbit but falls apart on close
inspection. Three problems dominate:

1. **No environment map**, which makes the physical materials inert.
2. **Procedurally bolted-on piece details** that read as modeling errors.
3. **A board texture that reads as linoleum**, not wood.

Everything else on this list is polish. Those three are structural.

---

## Structural problems

### 1. There is no environment map

`src/scene.js:227` creates the renderer and nothing ever assigns
`scene.environment`. But the materials are authored as if one existed:

- Pieces use `MeshPhysicalMaterial` with `clearcoat: 0.55` and `sheen`
  (`src/pieces.js:127-151`).
- Board squares use `clearcoat: 0.26` / `0.22` (`src/scene.js:96-123`).

Clearcoat and sheen are reflection effects. With nothing to reflect they
contribute almost nothing, so we pay the cost of a physical material and get a
Lambert look. In the close-up the white pieces read as matte plastic rather than
lacquered wood.

**Fix:** `PMREMGenerator` + `RoomEnvironment` (ships with the three.js addons —
no asset download), assigned to `scene.environment`, plus `envMapIntensity`
tuning on the existing materials. Roughly 10 lines. This is the highest-leverage
change available and should land before anything else, because it changes how
every other material decision reads.

### 2. The "classic details" are hurting the pieces

`src/pieces.js:329-392` bolts torus rings and boxes onto the loaded GLB models.
Up close these read as glitches, not craftsmanship:

- `addLatheRings` (`:329`) produces free-floating hoops that intersect the
  silhouette at the wrong radii — clearly visible cutting across the bishop and
  the king.
- `addFeltPad` (`:318`) renders as a black disc slightly wider than the piece
  base. It looks like a shadow artifact.
- `addQueenDetails` (`:363`) — crown jewels poke out as detached spheres.
- `addKingDetails` (`:351`) — the cross is two raw, untapered boxes.
- `addKnightDetails` (`:382`) — "mane carvings" are boxes at odd angles.

The root cause is that every detail is sized from a bounding box
(`addClassicDetails`, `:403-408`), so it cannot align with the model's actual
profile. No amount of constant-tweaking fixes that.

**Fix:** drop `addClassicDetails` for the Default set (`addClassicDetails: true`
at `src/pieces.js:16`). The GLB models are good on their own.

### 3. The board texture reads as linoleum

`public/textures/board/maple-burl.svg` tiles into a visible repeating rosette
motif on every light square. Combined with near-black dark squares
(`DARK_SQ = 0x724528` at `src/scene.js:9`, which tone-maps down to almost
black), contrast is crushed: no detail in the darks, and a washed-out specular
patch across the lights where the key light hits.

Real wood boards have far lower light/dark contrast and a *directional* grain,
not a radial pattern.

**Fix:** replace the SVGs with a directional grain, and lift the dark squares
to roughly `0x4a3426`.

---

## Prioritized recommendations

### Tier 1 — high impact, contained

| # | Change | Where |
|---|---|---|
| 1 | `RoomEnvironment` + PMREM → `scene.environment`; tune `envMapIntensity` | `src/scene.js` `_addLights` |
| 2 | Delete `addClassicDetails` for the Default set | `src/pieces.js:16`, `:403` |
| 3 | Directional wood grain; lift dark-square value | `public/textures/board/`, `src/scene.js:8-9` |
| 4 | Add `scene.fog` (exponential, matched to the theme's bottom color) so the table stops cutting hard against the gradient | `src/scene.js` `setTheme` |
| 5 | Raise piece wood-grain contrast and fix UV stretching — the procedural grain (`src/pieces.js:66-96`) is nearly invisible after tone mapping, and the cylindrical projection (`:167-188`) stretches it | `src/pieces.js` |

### Tier 2 — polish that reads as "produced"

**Post-processing.** There is no `EffectComposer` at all. Worth adding: subtle
bloom for specular highlights, SSAO or at minimum a fake contact-shadow decal
under each piece, and a vignette. Contact shadows matter most — pieces look
pasted onto the board because the single directional shadow
(`src/scene.js:280`) gives no grounding darkness at the base.

**Make themes actually thematic.** `src/themes.js:4-10` only swaps a background
gradient, so "Cosmos" and "Emerald" produce *identical* board and piece
rendering. A theme should carry key-light color and intensity, ambient and
hemisphere colors, fog color and density, env-map intensity, and optionally a
board wood tint. That turns five nearly-identical looks into five distinct ones
for maybe 30 lines.

**Better move feedback.** `src/scene.js:266-269` uses a flat unlit
`MeshBasicMaterial` ring. Missing states:

- *Selected piece* — currently there is **no** indication of which piece is
  selected, only which squares are legal.
- *Quiet move* — a soft filled dot would read better than a hard ring.
- *Capture* — should be visually distinct (red-tinted perimeter on the target).
- *Last move* — a persistent faint highlight on from/to. Standard in every chess
  UI; absent here.
- *Check* — a pulsing glow on the king.

**Capture animation.** `src/main.js:43` calls `removePieceAt` *before* the slide
starts, so a captured piece pops out of existence before the attacker arrives.
Reorder it and animate the removal (sink into the board, or scale + fade over
~200ms). This is the most dramatic moment in chess and currently it is the least
visual.

**Motion variety.** `src/scene.js:344` gives every piece the same 280ms arc hop.
Knights should arc high (they jump), sliding pieces should glide low and fast,
the king should move slowly. A slight settle on landing would help too.

### Tier 3 — bigger swings

- **Rebuild the environment.** The stone table (`src/scene.js:134-165`) is an
  untextured flat color built from 8- and 12-segment cylinders — visibly
  faceted, and at low camera angles that olive octagon fills half the frame.
  Either texture it properly (normal map, roughness variation, more segments) or
  replace it with a darker, smaller pedestal that recedes. A subtle ground plane
  below it would stop the "floating in a void" read.
- **Board frame.** Add a beveled inlay border with engraved a–h / 1–8
  coordinates. Cheap, and it immediately signals "real chess set."
- **Camera.** Static since load. A slow orbit-in on New Game and an eased
  transition when switching sides would add production feel for little code.
- **UI chrome.** `src/ui.js:21-62` is raw system `<select>` and
  `<input type=range>` on grey boxes — it reads as a debug overlay against a
  rendered 3D scene. Custom-styled controls on a glass/blur panel, plus a
  captured-piece tray and a move list, would do a lot.

---

## Suggested first pass

Tier 1 items 1, 2, and 4 (env map, remove the bolted-on details, fog) plus
contact shadows. Roughly 80 lines, and it changes the material read of the
entire scene.

---

## Unrelated notes

- `docs/readme-board-red-pieces.png` (referenced from `README.md`) is stale:
  pieces are blue now, and the UI has gained a **Pieces** selector.
- The only console error on load is a 404 for `/favicon.ico`.
