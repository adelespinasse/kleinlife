// Much of the code in this file was originally from
// https://webgpu.github.io/webgpu-samples/?sample=wireframe
// and licensed under the BSD 3-Clause "Revised" license (2019).
// It has been modified and extended by Alan deLespinasse.

import { mat4, mat3, vec3, type Vec3Arg } from 'wgpu-matrix';
import solidColorLitWGSL from './solidColorLit.wgsl?raw';
import wireframeWGSL from './wireframe.wgsl?raw';
import {
  quitIfWebGPUNotAvailable,
  quitIfLimitLessThan,
  quitIfAdapterNotAvailable,
} from './util';
import { kleinBottle, kleinBottleCoord, kleinBottleTangentU, kleinBottleTangentV } from './kleinBottle';
import { ToroidalLife } from './life';
import {
  type CameraPosition,
  originCamera,
  moveCameraTowardsGoal,
  cameraClose,
} from './camera';
import licenseText from '../LICENSE?raw';

// Parameters that can be set in URL
const params = new URLSearchParams(window.location.search);
const gridSize = params.get('grid') || '128x64'; // Must be powers of 2
(document.getElementById('grid-select') as HTMLSelectElement).value = gridSize;
const [tubularStr, radialStr] = gridSize.toLowerCase().split('x');
const tubularSegments = Number(tubularStr) || 128;
const radialSegments = Number(radialStr) || 64;
const initPattern = (params.get('init') || 'random').toLowerCase();
const msaaSampleCount = Number(params.get('msaa')) || 4; // Multisample AntiAliasing
const msaa = msaaSampleCount !== 1;
const immersion = params.get('immersion') || 'best'; // The shape to draw
(document.getElementById('immersion-select') as HTMLSelectElement).value = immersion;
let antMode = params.get('ant') !== null;
let antModeTransition = false;
let antProgress = 2.6 * Math.PI;
const antSpeed = Number(params.get('antspeed')) || 0.0002;
const antHeight = Number(params.get('antheight')) || 0.1;
const fovY = Number(params.get('fovy')) || 60;
const clipNear = Number(params.get('clipnear')) || 0.1;
const clipFar = Number(params.get('clipfar')) || 500;
const hexColor = params.get('color');
const showFrameRate = params.get('fps') !== null;
// bcw enables barycentric coordinates-based wireframe shaders instead of the
// regular line-line wireframe rendering.
// https://web.archive.org/web/20130424093557/http://codeflow.org/entries/2012/aug/02/easy-wireframe-display-with-barycentric-coordinates/
const bcWireframe = params.get('bcw') !== null;
const bcwElement = document.getElementById('bcw') as HTMLInputElement;
bcwElement.checked = bcWireframe;
const bcwWidth = Number(params.get('bcwWidth')) || 3; // line width for bc wireframe
const bcwWidthElement = document.getElementById('bcw-width') as HTMLInputElement;
bcwWidthElement.value = String(bcwWidth);
bcwWidthElement.disabled = !bcWireframe;
bcwElement.addEventListener('change', () => {
  bcwWidthElement.disabled = !bcwElement.checked;
});
const bcwAlphaThreshold = Number(params.get('bcwAlphaThresh')) || 0.3 // Affects antialiasing of bc wireframe

// Settings persisted from a previous session
const savedSettings = JSON.parse(
  window.localStorage.getItem('settings') || '{}',
);

// Settings the user can modify
const settings = {
  edges: true, // Toggles visibility of wireframe (hidden checkbox)
  faces: true, // Toggles visibility of live cells (hidden checkbox)
  animate: true, // Makes it rotate by itself
  lifeStepsPerSecond: 10,
  ...savedSettings,
};

function saveSettings() {
  window.localStorage.setItem(
    'settings',
    JSON.stringify(settings),
  );
}

const orbitDefaults = {
  direction: 0, // Direction (radians) on the xz plane from origin to camera
  elevation: .2, // Angle (radians) of camera above xz plane
  radius: 150, // Distance from origin to camera
};

const savedOrbit = JSON.parse(
  window.localStorage.getItem('camera') || '{}',
);

const orbit = {
  ...orbitDefaults,
  ...savedOrbit,
};

function saveOrbit() {
  window.localStorage.setItem(
    'camera',
    JSON.stringify(orbit),
  );
}

const helpButton = document.getElementById('help-button') as HTMLButtonElement;
const help = document.getElementById('help')!;
const helpDismiss = document.getElementById('help-dismiss') as HTMLButtonElement;
helpButton.addEventListener('click', () => {
  if (!help.style.display || help.style.display === 'none') {
    help.style.display = 'block';
  } else {
    help.style.display = 'none';
  }
});
helpDismiss.addEventListener('click', () => {
  help.style.display = 'none';
});
document.getElementById('license-toggle-section')!.innerText = licenseText;
for (const section of document.getElementsByClassName('section-toggle')) {
  section.addEventListener('click', (event) => {
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    const content = document.getElementById(target.id + '-section') as HTMLElement;
    const toggleIndicator = target.querySelector('.section-toggle-indicator') as HTMLElement;
    if (content.style.display === 'none' || !content.style.display) {
      content.style.display = 'block';
      toggleIndicator.innerText = '▼';
    } else {
      content.style.display = 'none';
      toggleIndicator.innerText = '▶';
    }
  });
}

const frameRateElement = document.getElementById('frame-rate') as HTMLElement;
if (showFrameRate) {
  frameRateElement.style.display = 'flex';
}
const edgesCheckbox = document.getElementById('edges') as HTMLInputElement;
const facesCheckbox = document.getElementById('faces') as HTMLInputElement;
const animateCheckbox = document.getElementById('animate') as HTMLInputElement;
const antModeCheckbox = document.getElementById('antmode') as HTMLInputElement;
edgesCheckbox.checked = settings.edges;
facesCheckbox.checked = settings.faces;
animateCheckbox.checked = settings.animate;
antModeCheckbox.checked = antMode;
edgesCheckbox.addEventListener('change', () => {
  settings.edges = edgesCheckbox.checked;
  saveSettings();
});
facesCheckbox.addEventListener('change', () => {
  settings.faces = facesCheckbox.checked;
  saveSettings();
});
animateCheckbox.addEventListener('change', () => {
  settings.animate = animateCheckbox.checked;
  saveSettings();
  if (!settings.animate) {
    saveOrbit();
  }
});
antModeCheckbox.addEventListener('change', () => {
  antMode = !antMode;
  antModeTransition = true;
  prevGoalCamera = undefined;
  console.log('Ant mode transition started');
});
const resetCameraButton = document.getElementById('reset-camera') as HTMLButtonElement;
resetCameraButton.addEventListener('click', () => {
  Object.assign(orbit, orbitDefaults);
  antMode = false;
  antModeCheckbox.checked = false;
  saveOrbit();
});
const lifeSpeedInput = document.getElementById('life-speed') as HTMLInputElement;
const lifeStepButton = document.getElementById('life-step') as HTMLButtonElement;
lifeSpeedInput.value = settings.lifeStepsPerSecond;
lifeStepButton.disabled = settings.lifeStepsPerSecond !== 0;
function updateLifeSpeed() {
  if (lifeSpeedInput.value.trim() == '') {
    return;
  }
  settings.lifeStepsPerSecond = Math.min(
    Number(lifeSpeedInput.max),
    Math.max(
      Number(lifeSpeedInput.min),
      Number(lifeSpeedInput.value || 1),
    ),
  );
  lifeSpeedInput.value = String(settings.lifeStepsPerSecond);
  lifeStepButton.disabled = settings.lifeStepsPerSecond !== 0;
  saveSettings();
}
lifeSpeedInput.addEventListener('input', updateLifeSpeed);

const hotKeys: Record<string, () => void> = {
  'a': () => {
    animateCheckbox.click();
  },
  '+': () => {
    lifeSpeedInput.value = String(Number(lifeSpeedInput.value) + 1);
    updateLifeSpeed();
  },
  '-': () => {
    lifeSpeedInput.value = String(Number(lifeSpeedInput.value) - 1);
    updateLifeSpeed();
  },
  ' ': () => {
    lifeStepButton.click();
  },
  'm': () => {
    antModeCheckbox.click();
  },
  'r': () => {
    resetCameraButton.click();
  },
  'h': () => {
    helpButton.click();
  },
  'escape': () => {
    helpDismiss.click();
    // Focus then defocus to defocus everything
    helpButton.focus();
    helpButton.blur();
  },
};
window.addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }
  const func = hotKeys[event.key.toLowerCase()];
  if (func) {
    func();
  }
});

// Calling this from an element's key event handler allows hotkeys to work when
// the element has keyboard focus, and prevents the element from doing its
// default thing with the event.
const propagateHotKeys = (event: KeyboardEvent) => {
  if (event.key.toLowerCase() in hotKeys) {
    event.preventDefault();
  } else {
    event.stopPropagation();
  }
};

lifeSpeedInput.addEventListener('keydown', propagateHotKeys);
const initializeSelect = document.getElementById('initialize') as HTMLSelectElement;
initializeSelect.addEventListener('keydown', propagateHotKeys);
// lifeStepButton click and initializeSelect change listeners have to be added
// later, after the ToroidalLife object is created.

type TypedArrayView = Float32Array | Uint32Array;

function createBufferWithData(
  device: GPUDevice,
  data: TypedArrayView,
  usage: GPUBufferUsageFlags
) {
  const buffer = device.createBuffer({
    size: data.byteLength,
    usage,
  });
  device.queue.writeBuffer(buffer, 0, data.buffer);
  return buffer;
}

type Model = {
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexFormat: GPUIndexFormat;
  vertexCount: number;
};

function createVertexAndIndexBuffer(
  device: GPUDevice,
  { vertices, indices }: { vertices: Float32Array; indices: Uint32Array }
): Model {
  const vertexBuffer = createBufferWithData(
    device,
    vertices,
    GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const indexBuffer = createBufferWithData(
    device,
    indices,
    GPUBufferUsage.INDEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  return {
    vertexBuffer,
    indexBuffer,
    indexFormat: 'uint32',
    vertexCount: indices.length,
  };
}

// WebGPU boilerplate
const adapter = await navigator.gpu?.requestAdapter({
  featureLevel: 'compatibility',
});
quitIfAdapterNotAvailable(adapter);
console.log(adapter.info);
const limits: Record<string, GPUSize32> = {};
quitIfLimitLessThan(adapter, 'maxStorageBuffersInVertexStage', 2, limits);
const device = await adapter?.requestDevice({
  requiredLimits: limits,
});
quitIfWebGPUNotAvailable(adapter, device);

const canvas = document.getElementById('the-canvas') as HTMLCanvasElement;
const context = canvas.getContext('webgpu') as GPUCanvasContext;
const devicePixelRatio = window.devicePixelRatio;
canvas.width = canvas.clientWidth * devicePixelRatio;
canvas.height = canvas.clientHeight * devicePixelRatio;
const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
context.configure({
  device,
  format: presentationFormat,
});
const depthFormat = 'depth24plus';

// Motion control
let dragging = false;
let lastX = 0;
let lastY = 0;

canvas.addEventListener('mousedown', (ev) => {
  ev.preventDefault();
  dragging = true;
  lastX = ev.clientX;
  lastY = ev.clientY;
});
canvas.addEventListener('mousemove', (ev) => {
  ev.preventDefault();
  if (dragging) {
    const deltaX = ev.clientX - lastX;
    const deltaY = ev.clientY - lastY;
    lastX = ev.clientX;
    lastY = ev.clientY;
    orbit.direction -= deltaX * .0005 * 2 * Math.PI;
    orbit.elevation += deltaY * .0005 * 2 * Math.PI;
    orbit.elevation = Math.min(Math.max(orbit.elevation, -Math.PI / 2 + 0.01), Math.PI / 2 - 0.01);
    saveOrbit();
  }
});
canvas.addEventListener('mouseup', (ev) => {
  ev.preventDefault();
  dragging = false;
});
canvas.addEventListener('touchstart', (ev) => {
  ev.preventDefault();
  if (ev.touches.length >= 1) {
    const touch = ev.touches.item(0)!;
    lastX = touch.clientX;
    lastY = touch.clientY;
    dragging = true;
  }
});
canvas.addEventListener('touchmove', (ev) => {
  ev.preventDefault();
  if (ev.touches.length === 1) {
    const touch = ev.touches.item(0)!;
    const deltaX = touch.clientX - lastX;
    const deltaY = touch.clientY - lastY;
    lastX = touch.clientX;
    lastY = touch.clientY;
    orbit.direction -= deltaX * .0005 * 2 * Math.PI;
    orbit.elevation += deltaY * .0005 * 2 * Math.PI;
    orbit.elevation = Math.min(Math.max(orbit.elevation, -Math.PI / 2 + 0.01), Math.PI / 2 - 0.01);
    // Intentionally not saving camera to localStorage on mobile
  }
});
canvas.addEventListener('touchend', (ev) => {
  ev.preventDefault();
  dragging = false;
});
canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  orbit.radius *= 1 + ev.deltaY * 0.001;
  orbit.radius = Math.min(Math.max(orbit.radius, 10), 1000);
  saveOrbit();
});
canvas.addEventListener('touchstart', (ev) => {
  ev.preventDefault();
});

const modelData = kleinBottle(tubularSegments, radialSegments, immersion, hexColor);
const model = createVertexAndIndexBuffer(device, modelData);

// More WebGPU stuff
// "Lit" refers to the filled-in polygons with a lighting model, as opposed to
// the wireframe.
const litModule = device.createShaderModule({
  code: solidColorLitWGSL,
});
const wireframeModule = device.createShaderModule({
  code: wireframeWGSL,
});
const litBindGroupLayout = device.createBindGroupLayout({
  label: 'lit bind group layout',
  entries: [
    {
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: {},
    },
  ],
});
const cellStateBindGroupLayout = device.createBindGroupLayout({
  label: 'cell state bind group layout',
  entries: [{
    binding: 0,
    visibility: GPUShaderStage.FRAGMENT,
    buffer: { type: 'read-only-storage' },
  }],
});

const litVertexBuffers: GPUVertexBufferLayout[] = [
  {
    arrayStride: 14 * 4,
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },        // position
      { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' },    // normal
      { shaderLocation: 2, offset: 6 * 4, format: 'float32x3' },    // front color
      { shaderLocation: 3, offset: 9 * 4, format: 'float32x3' },    // back color
      { shaderLocation: 4, offset: 12 * 4, format: 'float32' },     // tubular coord
      { shaderLocation: 5, offset: 13 * 4, format: 'float32' },     // radial coord
    ],
  },
];

function makeLitPipeline(sampleCount: number): GPURenderPipeline {
  return device.createRenderPipeline({
    label: `lit pipeline (${sampleCount}x)`,
    layout: device.createPipelineLayout({
      bindGroupLayouts: [litBindGroupLayout, cellStateBindGroupLayout],
    }),
    vertex: { module: litModule, buffers: litVertexBuffers },
    fragment: {
      module: litModule,
      targets: [{ format: presentationFormat }],
    },
    primitive: { cullMode: 'none' },
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: 'less',
      // Applying a depth bias can prevent aliasing from z-fighting with the
      // wireframe lines. The depth bias has to be applied to the lit meshes
      // rather that the wireframe because depthBias isn't considered when
      // drawing line or point primitives.
      depthBias: 1,
      depthBiasSlopeScale: 0.5,
      format: depthFormat,
    },
    multisample: { count: sampleCount },
  });
}

const litPipeline: GPURenderPipeline = makeLitPipeline(msaaSampleCount);

function makeWireframePipeline(sampleCount: number): GPURenderPipeline {
  return bcWireframe
    // Barycentric coordinates based wireframe pipeline
    ? device.createRenderPipeline({
        label: `barycentric coordinates based wireframe pipeline (${sampleCount}x)`,
        layout: 'auto',
        vertex: {
          module: wireframeModule,
          entryPoint: 'vsIndexedU32bcLines',
        },
        fragment: {
          module: wireframeModule,
          entryPoint: 'fsbcLines',
          targets: [
            {
              format: presentationFormat,
              blend: {
                color: {
                  srcFactor: 'one',
                  dstFactor: 'one-minus-src-alpha',
                },
                alpha: {
                  srcFactor: 'one',
                  dstFactor: 'zero',
                },
              },
            },
          ],
        },
        primitive: {
          // The shaders for barycentric coordinates based wireframe actually
          // draw filled-in triangles, except that they "discard" any pixels that
          // are not near the first two edges.
          topology: 'triangle-list',
        },
        depthStencil: {
          depthWriteEnabled: true,
          depthCompare: 'less-equal',
          format: depthFormat,
        },
        multisample: { count: sampleCount },
      })
    // regular line-list based wireframe pipeline
    : device.createRenderPipeline({
        label: `wireframe pipeline (${sampleCount}x)`,
        layout: 'auto',
        vertex: {
          module: wireframeModule,
          entryPoint: 'vsIndexedU32',
        },
        fragment: {
          module: wireframeModule,
          entryPoint: 'fs',
          targets: [{ format: presentationFormat }],
        },
        primitive: {
          topology: 'line-list',
        },
        depthStencil: {
          depthWriteEnabled: true,
          depthCompare: 'less-equal',
          format: depthFormat,
        },
        multisample: { count: sampleCount },
      });
}

const wireframePipeline = makeWireframePipeline(msaaSampleCount);

// Non-MSAA pipelines for XR rendering (XR runtime handles its own anti-aliasing)
const xrLitPipeline: GPURenderPipeline = msaa ? makeLitPipeline(1) : litPipeline;
const xrWireframePipeline: GPURenderPipeline = msaa ? makeWireframePipeline(1) : wireframePipeline;

// Make a uniform buffer and type array views
// for our uniforms.
const uniformValues = new ArrayBuffer(4 * Math.max(16 + 16 + 3 + 2, 144));
const uniformBuffer = device.createBuffer({
  size: uniformValues.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const f32bytes = Float32Array.BYTES_PER_ELEMENT;
const kWorldViewProjectionMatrixOffset = 0;
const kWorldMatrixOffset = 16 * f32bytes;
const kSegmentsOffset = kWorldMatrixOffset + 16 * f32bytes;
const kWireBrightnessDistanceOffset = kSegmentsOffset + 2 * f32bytes;
const kBcwParamsOffset = kWireBrightnessDistanceOffset + f32bytes;
const worldViewProjectionMatrixValue = new Float32Array(
  uniformValues,
  kWorldViewProjectionMatrixOffset,
  16,
);
const worldMatrixValue = new Float32Array(
  uniformValues,
  kWorldMatrixOffset,
  16,
);
const segmentsValues = new Uint32Array(
  uniformValues,
  kSegmentsOffset,
  2,
);
const wireBrightnessDistance = new Float32Array(
  uniformValues,
  kWireBrightnessDistanceOffset,
  1,
);
const bcwParams = new Float32Array(
  uniformValues,
  kBcwParamsOffset,
  2,
);
bcwParams[0] = bcwWidth;
bcwParams[1] = bcwAlphaThreshold;
// Make a bind group for this uniform
const litBindGroup = device.createBindGroup({
  label: 'Lit pipeline bind group',
  layout: litBindGroupLayout,
  entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
});
const wireframeBindGroup = device.createBindGroup({
  label: 'Wireframe pipeline bind group',
  layout: wireframePipeline.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: { buffer: uniformBuffer } },
    { binding: 1, resource: { buffer: model.vertexBuffer } },
    { binding: 2, resource: { buffer: model.indexBuffer } },
  ],
});
// XR wireframe pipeline may differ from regular (no MSAA), so needs its own bind group.
const xrWireframeBindGroup: GPUBindGroup = msaa
  ? device.createBindGroup({
      label: 'XR Wireframe pipeline bind group',
      layout: xrWireframePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: model.vertexBuffer } },
        { binding: 2, resource: { buffer: model.indexBuffer } },
      ],
    })
  : wireframeBindGroup;
const scale = 8;
const translation: Vec3Arg = [0, 0, 0];

const life = new ToroidalLife(device, tubularSegments, radialSegments);

function initLife(pattern: string) {
  switch (pattern) {
    case 'random':
      life.setRandom(.3);
      break;
    case 'gliders':
    case 'randomgliders':
      life.setRandomGliders(.4);
      break;
    case 'oneglider':
      life.setOneGlider();
      break;
    case 'rings':
      life.setYStripes();
      break;
    // case 'stripes':
    //   life.setXStripes();
    //   break;
    case 'randomrings':
      life.setRandomYStripes();
      break;
    case 'randomstripes':
      life.setRandomXStripes();
      break;
    case 'squares':
      life.setSquares();
      break;
    case 'anttrack':
      // Draws a stripe under the ant's path (assuming v = pi/4)
      life.setRandom(0.5);
      life.drawXStripe(radialSegments / 8);
      life.drawXStripe(radialSegments / 8 - 1);
      life.upload();
      break;
    case 'empty':
      life.setEmpty();
      break;
    case 'full':
      life.setFull();
  }
}

initLife(initPattern);

// Listeners for the last controls
initializeSelect.addEventListener('change', () => {
  initLife(initializeSelect.value);
});
lifeStepButton.addEventListener('click', () => {
  life.update();
});

let depthTexture: GPUTexture | undefined;
let multisampleTexture: GPUTexture | undefined;

function getAntCameraTransform(progress: number, immersionType: string): CameraPosition {
  // Progress goes from 0 to 4π for two complete circuits
  // Map this to u and v coordinates on the Klein bottle surface

  // For the ant path, we'll crawl along the "tubular" direction (u)
  // while staying at a fixed "radial" position (v)
  // The ant starts at v = 0 and after one circuit (at progress = 2π),
  // it should be on the "other side" (v = π), then complete another circuit

  const u = progress - 2 * Math.PI * Math.floor(progress / (2 * Math.PI)); // u goes from 0 to 2π
  const side = progress < 2 * Math.PI ? 1 : -1;
  const vPos = Math.PI / 4;
  const v = side > 0 ? Math.PI - vPos : vPos; // Switch to other side after first circuit

  // Get position on Klein bottle surface
  const position = kleinBottleCoord(u, v, immersionType);
  vec3.scale(position, scale, position);

  // Get tangent vector in u direction (direction of crawling)
  const tangentU = kleinBottleTangentU(u, v, immersionType);

  // Get tangent vector in v direction (perpendicular to crawling direction)
  const tangentV = kleinBottleTangentV(u, v, immersionType);

  // Normal vector (pointing away from surface)
  const normal = vec3.cross(tangentU, tangentV);
  vec3.normalize(normal, normal);
  vec3.scale(normal, side, normal);

  // Position camera slightly above the surface
  const cameraPos: Vec3Arg = [
    position[0] + normal[0] * antHeight,
    position[1] + normal[1] * antHeight,
    position[2] + normal[2] * antHeight
  ];

  // Look ahead along the crawling direction
  const lookAhead = 10.0;
  const targetPos: Vec3Arg = [
    cameraPos[0] + tangentU[0] * lookAhead,
    cameraPos[1] + tangentU[1] * lookAhead,
    cameraPos[2] + tangentU[2] * lookAhead
  ];

  return {
    eye: cameraPos,
    target: targetPos,
    up: normal,
  };
}

// Encode draw calls for the scene into an existing render pass encoder.
// The uniform buffer must be written before calling this.
function drawScene(
  pass: GPURenderPassEncoder,
  activeLitPipeline: GPURenderPipeline,
  activeWireframePipeline: GPURenderPipeline,
  activeWireframeBindGroup: GPUBindGroup,
  cellStateBindGroup: GPUBindGroup,
) {
  if (settings.faces) {
    pass.setPipeline(activeLitPipeline);
    pass.setVertexBuffer(0, model.vertexBuffer);
    pass.setIndexBuffer(model.indexBuffer, model.indexFormat);
    pass.setBindGroup(0, litBindGroup);
    pass.setBindGroup(1, cellStateBindGroup);
    pass.drawIndexed(model.vertexCount);
  }

  if (settings.edges) {
    pass.setPipeline(activeWireframePipeline);
    pass.setBindGroup(0, activeWireframeBindGroup);
    if (bcWireframe) {
      pass.draw(model.vertexCount);
    } else {
      pass.draw(model.vertexCount * 4 / 6);
    }
  }
}

// Render one view of the scene to the given render targets.
// Writes uniforms and submits a command buffer.
function renderScene(
  colorAttachment: GPURenderPassColorAttachment,
  depthAttachment: GPURenderPassDepthStencilAttachment,
  viewport: { x: number; y: number; width: number; height: number } | undefined,
  viewMatrix: Float32Array,
  projectionMatrix: Float32Array,
  eye: Vec3Arg,
  activeLitPipeline: GPURenderPipeline,
  activeWireframePipeline: GPURenderPipeline,
  activeWireframeBindGroup: GPUBindGroup,
) {
  const world = mat4.identity();
  mat4.translate(world, translation, world);
  mat4.uniformScale(world, scale, world);

  const viewProjection = mat4.multiply(projectionMatrix, viewMatrix);
  mat4.multiply(viewProjection, world, worldViewProjectionMatrixValue);
  mat3.multiply(viewMatrix, world, worldMatrixValue);
  mat3.invert(worldMatrixValue);
  mat3.transpose(worldMatrixValue);
  segmentsValues[0] = tubularSegments;
  segmentsValues[1] = radialSegments;
  wireBrightnessDistance[0] = Math.max(50, vec3.length(eye));
  device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

  const cellStateBindGroup = device.createBindGroup({
    label: 'Cell state bind group',
    layout: cellStateBindGroupLayout,
    entries: [{ binding: 0, resource: { buffer: life.currentCellState } }],
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    label: 'scene render pass',
    colorAttachments: [colorAttachment],
    depthStencilAttachment: depthAttachment,
  });
  if (viewport) {
    pass.setViewport(viewport.x, viewport.y, viewport.width, viewport.height, 0, 1);
  }
  drawScene(pass, activeLitPipeline, activeWireframePipeline, activeWireframeBindGroup, cellStateBindGroup);
  pass.end();
  device.queue.submit([encoder.finish()]);
}

// XR state
let xrSession: XRSession | null = null;
let xrReferenceSpace: XRReferenceSpace | null = null;
let xrBinding: XRGPUBinding | null = null;
let xrLayer: XRProjectionLayer | null = null;
// Depth textures keyed by imageIndex (one per eye)
const xrDepthTextures = new Map<number, GPUTexture>();

function xrFrame(ts: number, frame: XRFrame) {
  xrSession!.requestAnimationFrame(xrFrame);

  // Life simulation update
  if (lastLifeStep === undefined) {
    lastLifeStep = ts;
  }
  if (settings.lifeStepsPerSecond > 0) {
    const lifeStepMs = 1000 / settings.lifeStepsPerSecond;
    const nextLifeStep = Math.max(ts, lastLifeStep + lifeStepMs);
    if (ts >= nextLifeStep) {
      life.update();
      lastLifeStep = nextLifeStep;
    }
  }

  const pose = frame.getViewerPose(xrReferenceSpace!);
  if (!pose) return;

  for (const view of pose.views) {
    const subImage = xrBinding!.getViewSubImage(xrLayer!, view);
    const { x, y, width, height } = subImage.viewport;

    // Create or reuse a depth texture for this eye
    const idx = subImage.imageIndex;
    const existingDepth = xrDepthTextures.get(idx);
    if (!existingDepth ||
        existingDepth.width !== subImage.colorTexture.width ||
        existingDepth.height !== subImage.colorTexture.height) {
      existingDepth?.destroy();
      xrDepthTextures.set(idx, device.createTexture({
        size: [subImage.colorTexture.width, subImage.colorTexture.height],
        format: depthFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      }));
    }

    const colorView = subImage.colorTexture.createView({
      dimension: '2d',
      arrayLayerCount: 1,
      baseArrayLayer: idx,
    });
    const depthView = xrDepthTextures.get(idx)!.createView();

    const projectionMatrix = new Float32Array(view.projectionMatrix);
    const viewMatrix = new Float32Array(view.transform.inverse.matrix);
    const eye: Vec3Arg = [
      view.transform.position.x,
      view.transform.position.y,
      view.transform.position.z,
    ];

    renderScene(
      { view: colorView, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' },
      { view: depthView, depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'store' },
      { x, y, width, height },
      viewMatrix,
      projectionMatrix,
      eye,
      xrLitPipeline,
      xrWireframePipeline,
      xrWireframeBindGroup,
    );
  }
}

// VR button
const vrButtonContainer = document.getElementById('vr-button-container') as HTMLDivElement;
const vrButton = document.getElementById('vr-button') as HTMLButtonElement;
if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
    if (supported) {
      vrButtonContainer.style.display = '';
    }
  });
}
vrButton.addEventListener('click', async () => {
  if (xrSession) {
    xrSession.end();
    return;
  }
  try {
    const session = await navigator.xr!.requestSession('immersive-vr', {
      requiredFeatures: ['local-floor'],
    });
    xrSession = session;
    session.addEventListener('end', () => {
      xrSession = null;
      xrReferenceSpace = null;
      xrBinding = null;
      xrLayer = null;
      xrDepthTextures.forEach((t) => t.destroy());
      xrDepthTextures.clear();
      vrButton.textContent = 'Enter VR';
      lastLifeStep = undefined;
      requestAnimationFrame(render);
    });
    vrButton.textContent = 'Exit VR';
    xrReferenceSpace = await session.requestReferenceSpace('local-floor');
    xrBinding = new XRGPUBinding(session, device);
    xrLayer = xrBinding.createProjectionLayer({ colorFormat: presentationFormat });
    session.updateRenderState({ layers: [xrLayer] });
    session.requestAnimationFrame(xrFrame);
  } catch (e) {
    console.error('Failed to start VR session:', e);
  }
});

let lastFrame: number | undefined;
let lastLifeStep: number | undefined;
let cameraPosition: CameraPosition | undefined;
let prevGoalCamera: CameraPosition | undefined;
let frameRateCounter = 0;
let lastFrameRateCheckpoint = 0;
function render(ts: number) {
  if (lastLifeStep === undefined) {
    lastLifeStep = ts;
  }
  const lifeStepMs = 1000 / settings.lifeStepsPerSecond;
  const nextLifeStep = Math.max(ts, lastLifeStep + lifeStepMs);
  if (ts >= nextLifeStep) {
    life.update();
    lastLifeStep = nextLifeStep;
  }

  if (lastFrame === undefined) {
    lastFrame = ts;
    lastFrameRateCheckpoint = ts;
  }
  const deltaTime = ts - lastFrame;
  if (settings.animate) {
    if (!dragging) {
      if (antMode) {
        // Update ant progress
        antProgress += deltaTime * antSpeed;
        // Keep progress within [0, 4π] range for two complete circuits
        if (antProgress >= 4 * Math.PI) {
          antProgress -= 4 * Math.PI; // Reset to start
        }
      } else {
        orbit.direction += deltaTime * 0.0002;
      }
    }
  }
  lastFrame = ts;
  if (showFrameRate) {
    frameRateCounter++;
    const nextFrameRateCheckpoint = lastFrameRateCheckpoint + 1000;
    if (ts > nextFrameRateCheckpoint) {
      lastFrameRateCheckpoint = nextFrameRateCheckpoint;
      frameRateElement.innerText = 'FPS: ' + frameRateCounter;
      frameRateCounter = 0;
    }
  }

  // Get the current texture from the canvas context and
  // set it as the texture to render to.
  const canvasTexture = context.getCurrentTexture();

  // If we don't have a depth texture OR if its size is different
  // from the canvasTexture when make a new depth texture
  if (
    !depthTexture ||
    depthTexture.width !== canvasTexture.width ||
    depthTexture.height !== canvasTexture.height
  ) {
    if (depthTexture) {
      depthTexture.destroy();
    }
    depthTexture = device.createTexture({
      size: [canvasTexture.width, canvasTexture.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      sampleCount: msaaSampleCount,
    });
  }
  // Same idea for multisample texture (if doing msaa)
  if (
    msaa && (!multisampleTexture ||
    multisampleTexture.width !== canvasTexture.width ||
    multisampleTexture.height !== canvasTexture.height)
  ) {
    if (multisampleTexture) {
      multisampleTexture.destroy();
    }
    multisampleTexture = device.createTexture({
      format: canvasTexture.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      size: [canvasTexture.width, canvasTexture.height],
      sampleCount: 4,
    });
  }

  const aspect = canvas.clientWidth / canvas.clientHeight;
  // For landscape aspect ratios, we use the vertical fov as specified. If the
  // window is not wide enough, we increase the fov to try to fit the whole
  // bottle in view at standard orbit distance.
  const fov = Math.max(
    (fovY * Math.PI) / 180,
    (fovY * 2 / 3 / aspect * Math.PI) / 180,
  );
  const projection = mat4.perspective(fov, aspect, clipNear, clipFar);

  // Calculate the desired camera position based on either ant mode or regular
  // orbit mode.
  let goalCamera: CameraPosition = originCamera;
  if (antMode) {
    // Use ant camera transform
    goalCamera = getAntCameraTransform(antProgress, immersion);
  } else {
    // Use original orbiting camera
    goalCamera = {
      eye: [
        Math.sin(orbit.direction) * Math.cos(orbit.elevation) * orbit.radius,
        Math.sin(orbit.elevation) * orbit.radius,
        Math.cos(orbit.direction) * Math.cos(orbit.elevation) * orbit.radius,
      ],
      target: [0, 0, 0],
      up: [0, 1, 0],
    };
  }
  if (antModeTransition) {
    // When ant mode has been turned on or off, we don't want to jump to the
    // other POV, we want to do a smooth transition.
    cameraPosition = moveCameraTowardsGoal(cameraPosition, goalCamera, deltaTime, prevGoalCamera);
    prevGoalCamera = goalCamera;
    if (cameraClose(cameraPosition, goalCamera)) {
      antModeTransition = false;
      prevGoalCamera = undefined;
      console.log('Ant mode transition finished');
    }
  } else {
    cameraPosition = goalCamera;
  }
  const viewMatrix = mat4.lookAt(cameraPosition.eye, cameraPosition.target, cameraPosition.up);

  renderScene(
    {
      view: (msaa ? multisampleTexture! : canvasTexture).createView(),
      resolveTarget: msaa ? canvasTexture.createView() : undefined,
      clearValue: [0, 0, 0, 1],
      loadOp: 'clear',
      storeOp: 'store',
    },
    {
      view: depthTexture.createView(),
      depthClearValue: 1.0,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
    undefined,
    viewMatrix,
    projection,
    cameraPosition.eye,
    litPipeline,
    wireframePipeline,
    wireframeBindGroup,
  );

  if (!xrSession) {
    requestAnimationFrame(render);
  }
}
requestAnimationFrame(render);
