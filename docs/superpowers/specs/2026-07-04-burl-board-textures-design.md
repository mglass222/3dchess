# Burl Board Texture Design

## Goal

Upgrade the chessboard surface from flat material colors to realistic image-textured wood: walnut burl for the dark squares and frame, maple burl for the light squares.

## Approved Direction

Use image texture files rather than purely procedural shader/canvas textures. The board should read like a high-end veneered chessboard, with glossy or satin-finished figured wood:

- Light squares: pale maple burl with creamy gold figure, small knots, and swirling grain.
- Dark squares: walnut burl with deep brown figure, amber variation, and tight swirl/cathedral patterns.
- Frame: walnut burl or a darker companion walnut/ebony-toned wood that matches the board.

The current stone table, upgraded pieces, lighting, camera clamp, theme selector, and gameplay behavior stay unchanged.

## Texture Asset Requirements

The implementation should add texture image files under `public/textures/board/`.

Preferred assets:

- Seamless or tile-safe image textures.
- CC0 or project-compatible license.
- Reasonable web size after compression, targeting about 1K square textures for each wood type unless visual QA shows that 2K is necessary.
- No embedded watermarks, logos, text, or obvious plank seams.

If exact CC0 burl assets are not cleanly downloadable, use generated seamless texture images for this repo and document them as generated assets. Do not use login-gated previews, unclear licenses, or retail product photos as texture sources.

Useful reference/source leads found during design:

- Poly Haven offers free wood PBR textures, including walnut veneer, suitable as a licensed fallback if exact burl is unavailable: https://polyhaven.com/a/walnut_veneer
- ambientCG publishes CC0 texture assets and states its assets are released under Creative Commons CC0: https://ambientcg.com/
- Retail walnut burl / maple chessboard references confirm the desired material pairing and visual target, but must not be used as texture assets.

## Rendering Design

Use Three.js texture maps on the existing board materials:

- Load the wood images with `THREE.TextureLoader`.
- Configure textures with `SRGBColorSpace`, repeat wrapping, and anisotropy where available.
- Give each square a cloned material or texture transform so neighboring squares do not look like identical repeats.
- Keep the current physical-material clearcoat/roughness direction, but tune the finish toward polished satin wood instead of plastic gloss.
- Keep highlights/raycasting unchanged: board top stays at `y=0`, the invisible pick plane remains the interaction surface.

## Testing and Verification

Add focused tests for any new helper that creates or configures board texture descriptors/materials. Node tests should not depend on browser image loading.

Run:

- `npm test`
- `npm run build`
- Browser visual QA on desktop and mobile

Visual QA should confirm:

- Light squares read as maple burl, not plain beige.
- Dark squares and frame read as walnut burl, not flat brown.
- Texture repetition is not distractingly obvious.
- Pieces, legal-move rings, and click selection still work.
- Existing themes still work in this phase.

## Non-Goals

- Changing the stone table.
- Replacing piece models or piece materials.
- Removing themes.
- Adding the garden/waterfall scene.
