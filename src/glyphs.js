// Vector glyph data for the board's engraved a-h / 1-8 coordinates, plus the
// pure math that turns a polyline into a signed-distance-esque field (it's
// only ever evaluated OUTSIDE the stroke, so it's really just "distance to
// nearest stroke", not a true two-sided SDF - fine, since a groove has no
// inside to be negative in).
//
// REJECTED: canvas fillText(). It rasterises differently per platform/font
// stack (different hinting, different fallback fonts on a machine without
// the requested one installed) and produces NOTHING under node, where
// createChessBoard's texture branch has no canvas at all (see pieces.js's
// `typeof document` guard) - non-deterministic in the browser and untestable
// under node.
// REJECTED: FontLoader + TextGeometry, and MSDF text. Both need a font/atlas
// asset shipped with the project, and public/textures/board/README.md states
// the project's position on that explicitly: "intentionally local generated
// assets so the project does not depend on login-gated, preview-only, or
// unclear-license texture sources."
//
// So: 16 glyphs (a-h, 1-8), each a handful of straight polyline strokes in a
// 0..1 "em box", authored once as plain numbers below. License-clean by
// construction (nobody else's design, nobody else's font file), identical in
// node and the browser (same arithmetic either way), and - the actual payoff
// - the rasteriser in coordinates.js can derive a DISTANCE FIELD from these
// strokes, and a distance field is what turns "texture painted on the wood"
// into "channel cut into the wood": grooveDepth below falls linearly from 1
// at a stroke's centreline to 0 at its edge (a V-bit's flat conical wall,
// not a smoothstep's soft round-over - see grooveDepth's own comment), and
// its gradient is the exact wall normal for coordinates.js's normal map.
//
// Coordinate convention: v=0 is the TOP of the glyph, v=1 is the BOTTOM -
// i.e. plain image-row order (row 0 first), not math's y-up. This is a
// deliberate choice, not an accident: coordinates.js rasterises this data row
// by row into a texture, and keeping the glyph's own "top"/"bottom" in the
// same sense as the raster's row order means the rasteriser never has to
// flip anything to lay a glyph into its cell - one fewer place to get a sign
// wrong. World-space orientation (which edge of a plank shows the top of a
// letter) is handled entirely in coordinates.js, by the plank's transform,
// not by this module.

// Shared 7-segment-style grid, reused by every digit for consistency (a
// mismatched grid across digits would make them subtly different sizes).
const SEG = {
  a: [[0.28, 0.10], [0.72, 0.10]], // top bar
  b: [[0.72, 0.10], [0.72, 0.50]], // upper-right vertical
  c: [[0.72, 0.50], [0.72, 0.90]], // lower-right vertical
  d: [[0.28, 0.90], [0.72, 0.90]], // bottom bar
  e: [[0.28, 0.50], [0.28, 0.90]], // lower-left vertical
  f: [[0.28, 0.10], [0.28, 0.50]], // upper-left vertical
  g: [[0.28, 0.50], [0.72, 0.50]], // mid bar
};

// Standard 7-segment encodings for 1-8 (a plain "I" for 1 - just the two
// right-hand segments, which are collinear and read as one clean stroke).
const DIGIT_SEGMENTS = {
  1: ['b', 'c'],
  2: ['a', 'b', 'g', 'e', 'd'],
  3: ['a', 'b', 'g', 'c', 'd'],
  4: ['f', 'g', 'b', 'c'],
  5: ['a', 'f', 'g', 'c', 'd'],
  6: ['a', 'f', 'g', 'e', 'c', 'd'],
  7: ['a', 'b', 'c'],
  8: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
};

function digitStrokes(digit) {
  return DIGIT_SEGMENTS[digit].map((key) => SEG[key]);
}

// Letters share the digits' left/right/top/bottom rails (0.28/0.72/0.10/0.90)
// so every glyph in the set reads at the same visual size, but are their own
// monoline block forms - built from straight strokes only, same reason the
// digits are 7-segment rather than curved: a curve needs many short segments
// to approximate well, and glyphDistance's cost is linear in segment count
// summed over every texel of the strip texture.
export const GLYPH_STROKES = {
  1: digitStrokes(1),
  2: digitStrokes(2),
  3: digitStrokes(3),
  4: digitStrokes(4),
  5: digitStrokes(5),
  6: digitStrokes(6),
  7: digitStrokes(7),
  8: digitStrokes(8),
  a: [
    [[0.28, 0.90], [0.50, 0.10], [0.72, 0.90]], // the two legs, apex at top
    [[0.36, 0.60], [0.64, 0.60]], // crossbar
  ],
  b: [
    [[0.28, 0.10], [0.28, 0.90]], // full-height spine
    [[0.28, 0.50], [0.68, 0.50], [0.68, 0.90], [0.28, 0.90]], // squared bowl, lower half
  ],
  c: [
    [[0.72, 0.10], [0.28, 0.10], [0.28, 0.90], [0.72, 0.90]], // open bracket, open right
  ],
  d: [
    [[0.72, 0.10], [0.72, 0.90]], // full-height spine
    [[0.72, 0.50], [0.32, 0.50], [0.32, 0.90], [0.72, 0.90]], // squared bowl, lower half
  ],
  e: [
    [[0.28, 0.10], [0.28, 0.90]], // spine
    [[0.28, 0.10], [0.72, 0.10]], // top bar
    [[0.28, 0.50], [0.62, 0.50]], // mid bar
    [[0.28, 0.90], [0.72, 0.90]], // bottom bar
  ],
  f: [
    [[0.28, 0.10], [0.28, 0.90]], // spine
    [[0.28, 0.10], [0.72, 0.10]], // top bar
    [[0.28, 0.50], [0.62, 0.50]], // mid bar
  ],
  g: [
    // One continuous stroke: right edge just below top, up and across the
    // top, down the left edge, across the bottom, up the right edge to
    // mid-height, then inward - the classic squared "G" terminal spur that
    // is the one thing distinguishing it from a plain "C".
    [
      [0.72, 0.30], [0.72, 0.10], [0.28, 0.10], [0.28, 0.90],
      [0.72, 0.90], [0.72, 0.55], [0.50, 0.55],
    ],
  ],
  h: [
    [[0.28, 0.10], [0.28, 0.90]], // left vertical
    [[0.72, 0.10], [0.72, 0.90]], // right vertical
    [[0.28, 0.50], [0.72, 0.50]], // crossbar
  ],
};

export const GLYPH_CHARS = Object.keys(GLYPH_STROKES);

// Half-width of a stroke, in the same 0..1 em-box units as GLYPH_STROKES.
// Chosen so a single stroke's ink band (2 * STROKE_HALF_WIDTH = 0.084) reads
// clearly at the strip texture's per-glyph cell resolution (256x256px, see
// coordinates.js) without strokes fusing together where they run close and
// parallel (e.g. "h"'s two verticals, 0.44 apart at their nearest).
export const STROKE_HALF_WIDTH = 0.042;

// Euclidean distance from (u, v) to the nearest point on segment (ax,ay)-(bx,by),
// plus which point on the segment was nearest (needed by glyphGradient below -
// the direction FROM that nearest point TO (u, v) is the distance field's
// analytic gradient).
function distanceToSegment(u, v, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  let t = lenSq > 0 ? ((u - ax) * abx + (v - ay) * aby) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const dx = u - cx;
  const dy = v - cy;
  return { distance: Math.hypot(dx, dy), dx, dy };
}

// Distance from (u, v) to the nearest stroke of `char`, plus the field's
// analytic unit gradient (points away from the nearest stroke - i.e. the
// direction distance increases fastest). A Euclidean distance-to-a-segment
// field has gradient magnitude exactly 1 everywhere except ON a segment
// (undefined there - the two straight-line "wall" pieces of the V meet with
// no single tangent), so degenerate zero-distance texels fall back to a
// zero vector (read by coordinates.js as "flat, no groove here", which is
// the right answer at the V's own centreline, the one line where the two
// walls meet and there is no slope to speak of in either wall's own frame).
export function glyphDistanceAndGradient(char, u, v) {
  const strokes = GLYPH_STROKES[char];
  if (!strokes) throw new Error(`glyphs.js: no glyph for "${char}"`);
  let best = Infinity;
  let bestDx = 0;
  let bestDy = 0;
  for (const points of strokes) {
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[i + 1];
      const { distance, dx, dy } = distanceToSegment(u, v, ax, ay, bx, by);
      if (distance < best) {
        best = distance;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }
  if (best <= 0) return { distance: 0, nx: 0, ny: 0 };
  return { distance: best, nx: bestDx / best, ny: bestDy / best };
}

export function glyphDistance(char, u, v) {
  return glyphDistanceAndGradient(char, u, v).distance;
}

// V-groove profile: 1 at a stroke's centreline, falling LINEARLY to 0 at
// STROKE_HALF_WIDTH away, 0 beyond that. Linear, not smoothstep (3t^2 - 2t^3):
// a smoothstep profile has zero slope at both ends, which is exactly what a
// soft, sanded-round dent looks like - it reads as pressed-in, not cut. A
// V-bit leaves flat conical walls with a constant slope from rim to
// centreline (zero only in the second derivative, not the first), and
// that's what actually reads as "carved" rather than "dented" - see
// coordinates.js's normal-map comment for how this constant slope becomes
// the groove's normal.
export function grooveDepth(char, u, v) {
  const distance = glyphDistance(char, u, v);
  return Math.max(0, 1 - distance / STROKE_HALF_WIDTH);
}

// Wall steepness of the V-groove, expressed as dHeight/d(em-box unit) at the
// wall (a plain slope, not an angle - so it composes by simple addition with
// coordinates.js's separate chamfer slope before the two are normalized
// together into one normal). 1.0 is a ~45 degree half-angle: a convincing,
// legible V-bit cut without the wall going so steep it clips to pure black
// under grazing light.
export const GROOVE_SLOPE = 1.0;

// The groove's own height-field partial derivatives at (u, v), zero outside
// STROKE_HALF_WIDTH. This is a glyph-only quantity - it knows nothing about
// the strip texture's layout or the inlay's edge chamfer; coordinates.js
// adds its own chamfer term to `dhdv` before turning the pair into an actual
// surface normal (see glyphNormal below for the groove-only case).
//
// Derivation: grooveDepth(char, u, v) = 1 - distance/STROKE_HALF_WIDTH inside
// the groove, so d(grooveDepth)/d(distance) = -1/STROKE_HALF_WIDTH, and
// d(distance)/d(u,v) is glyphDistanceAndGradient's (nx, ny) - a unit vector
// pointing away from the stroke, by construction of a Euclidean distance
// field. Treating the groove as a height field h = -GROOVE_SLOPE *
// STROKE_HALF_WIDTH * grooveDepth (deepest at the centreline, 0 at the
// wall's rim) and applying the chain rule gives dh/d(u,v) = GROOVE_SLOPE *
// (nx, ny) - i.e. exactly GROOVE_SLOPE scaled by the same unit vector, which
// is why the STROKE_HALF_WIDTH terms cancel and this can be written directly
// in terms of (nx, ny) without re-deriving the depth scale here.
export function glyphGroovePartials(char, u, v) {
  const { distance, nx, ny } = glyphDistanceAndGradient(char, u, v);
  if (distance >= STROKE_HALF_WIDTH) return { dhdu: 0, dhdv: 0 };
  return { dhdu: GROOVE_SLOPE * nx, dhdv: GROOVE_SLOPE * ny };
}

// Tangent-space normal for the groove alone (no chamfer - see
// coordinates.js for the strip-level normal map that adds one). Standard
// heightfield-to-normal conversion: normal = normalize(-dh/du, -dh/dv, 1).
// Because (nx, ny) inside the groove is always a unit vector (a Euclidean
// distance field's gradient magnitude is exactly 1 anywhere it's
// differentiable), dhdu^2 + dhdv^2 is exactly GROOVE_SLOPE^2 everywhere
// inside the groove and exactly 0 everywhere outside it - so the resulting z
// is exactly 1/sqrt(1 + GROOVE_SLOPE^2) inside and exactly 1 outside, never
// anything in between, and with GROOVE_SLOPE = 1 that floor is 1/sqrt(2) =
// 0.7071 - comfortably past the "reads as carved, not flat" bar.
export function glyphNormal(char, u, v) {
  const { dhdu, dhdv } = glyphGroovePartials(char, u, v);
  const len = Math.sqrt(dhdu * dhdu + dhdv * dhdv + 1);
  return [-dhdu / len, -dhdv / len, 1 / len];
}

// Shared AO+roughness value (see coordinates.js for why one Texture object
// is assigned to both aoMap and roughnessMap): 1.0 (no change to the
// material's base AO/roughness) outside the groove, falling to
// ORM_GROOVE_FLOOR at the groove's own centreline. Both channels use this
// SAME value - see coordinates.js's ORM comment for why "lower inside" is
// the correct call for aoMap (darker = more occluded, right) and for
// roughnessMap too (a cut V-groove's compressed, burnished wall reads
// smoother/shinier than the surrounding finished wood, not rougher - the
// multiplicative roughnessMap model can only ever REDUCE roughness from the
// material's base value, never raise it, so "rougher inside" was never
// reachable through this channel regardless of which value we picked).
export const ORM_GROOVE_FLOOR = 0.5;

export function glyphOcclusionRoughness(char, u, v) {
  const depth = grooveDepth(char, u, v);
  return 1 - (1 - ORM_GROOVE_FLOOR) * depth;
}
