# TexelForge Devpost update

Paste-ready sections for a project page. Every number below was copied from `npm test` and from `synthesize()` in `js/texel-maps.js` on the current code. Rerun both before pasting if the code changes.

## Inspiration

Low-bit hardware made beautiful images out of a handful of colors and a clever threshold pattern. I wanted a workstation where you can raymarch real 3D shapes and watch them pass through the same ordered dither, then build the textures those surfaces would need.

## What it does

TexelForge raymarches five signed distance field shapes in a WebGL 2 fragment shader and pushes every pixel through Bayer or scanline dithering into one of five palettes. A uniform inspector reads every shader value back from the GPU and lets you edit it live, and every control is mirrored into a shareable link.

The new Maps tab synthesizes a full tileable material at texel resolution for four surface patterns. It builds a height field, a normal map in the OpenGL convention, horizon-based ambient occlusion and a roughness map, then lights the result with the scene's own light and dithers it with the same formula and palette ramp as the shader. Save map atlas exports all five images in one PNG.

The shareable link includes the material pattern, seed, bump strength and occlusion radius alongside the scene and camera controls. The figures below use the default seed 7 at 64 by 64 texels.

| Pattern | Seam jump | Largest interior jump | Mean occlusion |
| --- | --- | --- | --- |
| Riveted plates | 0.005425 | 0.535391 | 0.618534 |
| Cobblestone | 0.369449 | 0.402691 | 0.515169 |
| Hex tiles | 0.002372 | 0.733585 | 0.767082 |
| Corroded noise | 0.087676 | 0.187647 | 0.761191 |

For the default seed 7 shown above, the seam jump across the tile boundary is smaller than the largest interior jump, and the panel reports both live. Periodic coordinates and wrapped sampling give exact tile continuity, though they do not guarantee that ordering for every seed (for instance, cobblestone at seed 13 and size 64 has wrap jump 0.402244389 vs interior maximum 0.401748806).

## How we built it

One HTML file for the shader workstation, plus one plain JavaScript module for the material maps that runs in the browser and in Node. No build step, no dependencies and no network requests. The two fonts are self hosted.

## Challenges

Tiling had to be exact, not approximate. Every pattern is periodic by construction and every neighbor lookup wraps, and a test proves it by comparing wrap-around normals with normals computed inside a 2 by 2 tiled copy, where no wrap is needed.

Matching the shader mattered too. The Bayer thresholds, the quantizer and the palette ramp in the preview follow the fragment shader line for line, and tests check the Bayer tables against the classic matrices and check that the ordered dither preserves the average brightness of a flat field.

## Accomplishments

50 automated tests pass. The map statistics on screen are computed from the maps themselves, and the roughness map is labeled as a heuristic rather than a measured material.

## What's next

Feeding the synthesized normal and occlusion maps into the raymarcher as triplanar surface detail.

## Built with

WebGL 2, GLSL, JavaScript, HTML canvas, CSS, Node.js test runner
