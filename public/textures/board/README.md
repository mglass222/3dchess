# Board wood materials

The active board uses locally bundled 1024 × 1024 JPEG maps from Poly Haven:

- `cherry-{color,normal,roughness}.jpg`: [Cherry Veneer](https://polyhaven.com/a/cherry_veneer), Jenelle van Heerden.
- `walnut-{color,normal,roughness}.jpg`: [European Walnut Veneer 05](https://polyhaven.com/a/european_walnut_veneer_05).

Both assets are released under [CC0](https://polyhaven.com/license).
Downloaded September 5, 2026. Original download URLs and verified MD5 hashes
are recorded in `sources.json`. Images are unmodified, renamed for the app.
The six maps total approximately 2.6 MiB. No runtime external requests are needed.

Color maps use sRGB. OpenGL normal maps and roughness maps use NoColorSpace.
All three maps share UV scale, offset and rotation for each veneer square.
The normal strength is reduced for a sanded, varnished finish. Frame and table
use physical grain coordinates so the texture follows each rail's long axis.

The older `maple-grain.svg` and `walnut-grain.svg` are original procedural project
assets retained for reference; they are no longer used by the renderer.
