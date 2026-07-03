# Garden Scene and Piece Quality Design

## Goal

Replace the current selectable background/theme presentation with one polished outdoor garden scene for the 3D chess board. The board should sit on a stone table in a lush garden with a waterfall, use higher-quality-looking chess pieces, and prevent the camera from rotating below board level.

## Current Context

The app is a Vite and Three.js chess game. Rendering lives mainly in `src/scene.js`, piece loading and normalization in `src/pieces.js`, theme/background generation in `src/themes.js`, and UI theme selection in `src/ui.js`. The app already loads MIT-licensed GLB chess pieces from `public/models/` and uses `OrbitControls` for board rotation.

The current scene supports multiple gradient/procedural themes. This work will simplify that into one garden scene instead of retaining the theme selector.

## Approved Direction

Use a hybrid garden approach:

- A high-quality generated panoramic garden/waterfall image provides the distant scenic backdrop.
- Three.js geometry provides the near-field physical scene: stone table, board, rocks, foliage accents, subtle water/pond surfaces, and shadow-catching ground.
- Existing GLB chess pieces remain the base model source, but their presentation is upgraded through materials, scale, lighting, shadows, and small supporting geometry where useful.

This keeps the scene visually richer than pure procedural geometry while preserving enough real 3D structure around the board for orbiting to feel convincing.

## Scene Design

The board sits on a broad carved stone table. The table should be visibly larger than the board, with a rounded or chamfered slab, sturdy pedestal or base, rough stone material, and contact shadows beneath pieces and board edges. The garden surrounds the table with a waterfall in the background, layered greenery, rocks, and a natural sky/lighting mood.

The generated background should be used as an environment/backdrop layer, not as the board itself. The playable board, table, pieces, highlights, and click targets remain code-native 3D objects.

The board remains the interaction focus. Garden details should frame it without obscuring pieces, legal-move rings, promotion UI, or status controls.

## Piece Quality

Keep the current licensed GLB model set for this pass. Improve perceived quality by:

- Using richer PBR-style materials: polished ivory for white and dark carved wood or ebony for black.
- Adjusting roughness, metalness, and renderer color management/tone mapping for better highlights.
- Preserving model normalization while tuning the final scale if needed so pieces feel substantial on the board.
- Ensuring every mesh casts and receives soft shadows.
- Adding subtle bases/plinths only if the existing model silhouettes still look too thin or low-quality after material and lighting changes.

Replacing the full model set is out of scope for this pass because it introduces asset search, licensing, model scale compatibility, and download size risk.

## Camera and Controls

Keep orbit controls and zoom. Clamp the vertical orbit so the camera cannot go below the board/table. Use `controls.maxPolarAngle = Math.PI / 2 - 0.04` as the initial target so the camera stops just above the horizontal view line. Minimum polar angle remains near top-down but should avoid pole flipping.

Zoom limits should be adjusted so the board, table, and enough waterfall context remain visible without letting the camera clip through the scene.

## UI Changes

Remove the theme selector from the overlay because the game will now have one scene. The rest of the UI remains unchanged: new game, side selection, difficulty, status, and promotion controls.

If local storage contains an old saved theme key, the app should ignore it safely.

## Implementation Boundaries

Primary files expected to change:

- `src/scene.js`: lighting, renderer settings, board/table/garden scene construction, camera clamp.
- `src/themes.js`: replace or retire multi-theme backdrop helpers in favor of a single garden scene/backdrop helper.
- `src/pieces.js`: material upgrades and optional small presentation helpers.
- `src/ui.js` and `src/main.js`: remove theme selector wiring and theme persistence.
- `public/`: add generated garden/waterfall asset if used.
- Tests under `test/`: update theme/UI expectations and add coverage for any changed scene or piece behavior where practical.

Avoid broad refactors unrelated to the scene, chess rules, AI, or input behavior.

## Asset Plan

Generate a wide garden/waterfall backdrop suited for a 3D chess game:

- Outdoor garden, stone table foreground context, waterfall in the distance, lush greenery, natural daylight.
- No text, logos, people, or chess pieces embedded in the image.
- Composition should leave the central board area clear and keep the waterfall behind or offset from the board.
- Use a wide aspect ratio suitable for a browser canvas background.

If API-based image generation is unavailable, use a procedural fallback in Three.js so development can continue, but the final target remains a generated high-quality scenic asset.

## Testing and Verification

Run:

- `npm test`
- `npm run build`
- Browser verification through the local dev server

Visual verification should check:

- Pieces load and appear materially improved.
- The board sits convincingly on a stone table.
- Garden/waterfall scenery frames the board without blocking play.
- Camera cannot rotate below the board/table.
- Selection and legal-move highlights still work.
- Desktop and mobile viewports keep controls and text readable.

## Non-Goals

- Changing chess rules, AI behavior, or move animation semantics.
- Adding new gameplay modes.
- Downloading or replacing the full chess model set in this pass.
- Keeping the previous theme selector.
