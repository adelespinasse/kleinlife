# Conway's Game of Life on a Klein bottle

View on the web at [kleinlife.aldel.com](https://kleinlife.aldel.com).

## Development

Requires Node.js and npm.

To install, clone this repo and cd into its root directory, then run:

```
npm install
npm run dev
```

Load the URL printed by the dev script in your browser.

## Organization

* `index.html`: Main HTML file (gets modified by the build process).
* `src/`: All other source code (TypeScript, WGSL).
    * `main.ts`: Main source entry point; includes UI and rendering.
    * `kleinBottle.ts`: Klein bottle and other shapes and colors.
    * `life.ts`: Conway's Game of Life.
    * `camera.ts`: 3D camera animation.
    * `solidColorLit.wgsl`: Shaders for the solid-color quadrilaterals representing live Life cells.
    * `wireframe.wgsl`: Shaders for the wireframe model.
    * `life.wgsl`: Compute shader to run Life.

## Licensing

This project is licensed under the [Apache License, Version 2.0](LICENSE).

It also includes or is derived from portions of the following projects:

- [Your First WebGPU App Codelab](https://github.com/GoogleChromeLabs/your-first-webgpu-app-codelab)
  Licensed under the [Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0).

- [WebGPU Samples](https://github.com/webgpu/webgpu-samples)
  Licensed under the BSD 3-Clause "New" or "Revised" License (2019).
  The full text of this license is included in the [LICENSE](LICENSE) file.

For attribution details, see the [NOTICE](NOTICE) file.
