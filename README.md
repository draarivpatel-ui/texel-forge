# TexelForge

A real-time WebGL GLSL signed-distance raymarcher and ordered 4x4 Bayer matrix texel quantizer built for exploring low-bit depth dithering, voxel iso-surfaces, and palette quantization in the browser.

![TexelForge Studio](texel_forge_demo.png)

## Features

- **Ordered 4x4 Bayer Texel Quantization** Applies a programmable 16-threshold Bayer dither matrix (`bayer4`) at adjustable pixel block scales (`1px` to `12px`) and color quantization depths (`2` to `16` levels per channel)
- **Signed-Distance Field (SDF) Raymarching** Real-time 64-step fragment raymarcher with dual directional lighting, Fresnel rim shading, and three procedural 3D primitives (Torus Knot, Menger Voxel Box, and Gyroid Iso-Surface)
- **One-Click PNG Frame Export** Captures the quantized WebGL framebuffer directly to a lossless PNG

## Live Demo

`https://aariv.me/texel-forge/`
