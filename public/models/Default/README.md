# Default Staunton pieces

Generated GLBs load directly in the browser. Run `npm run models:build` to rebuild
from the checked-in authoring script and the existing Downloaded GLB.
Meshoptimizer is an offline development dependency, not part of the game bundle.

The set has stepped/beaded bases, curved shoulders, rolled collars, a slotted
bishop, six rook crenellations, an eight-point continuous queen crown, and a substantial beveled king cross.
The knight uses an optimized carved horse head on a matching new pedestal.
See LICENSE.txt for the head's CC BY 4.0 attribution and modification notice.

Each mesh includes authoredWoodUVs in its glTF node extras. This tells pieces.js
to preserve its authored UVs and share immutable geometry across instances.
Reference counting releases GPU storage when the last instance leaves the board.
Legacy imported models still use the existing projection and disposal path.

All models use a common scale based on a 1.4-square king. A final vertical
adjustment aligns the king's collar rim with the queen's, making the Default king
approximately 1.504 squares tall without resizing other pieces.
The six GLBs total approximately 1.2 MiB and need no runtime geometry generation.
