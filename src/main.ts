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
import VideoWorker from './videoWorker?worker';

// Parameters that can be set in URL
const params = new URLSearchParams(window.location.search);
const tubularSegments = Number(params.get('x')) || 128; // Must be power of 2
const radialSegments = Number(params.get('y')) || 64; // Must be power of 2
const initPattern = (params.get('init') || 'random').toLowerCase();
const msaaSampleCount = Number(params.get('msaa')) || 4; // Multisample AntiAliasing
const msaa = msaaSampleCount !== 1;
const immersion = params.get('immersion') || 'best'; // The shape to draw
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
const bcwWidth = Number(params.get('bcwWidth')) || 3; // line width for bc wireframe
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
const licenseLink = document.getElementById('license-link') as HTMLLinkElement;
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
licenseLink.addEventListener('click', () => {
  const textEl = document.getElementById('license-text') as HTMLElement;
  if (!textEl.innerText.trim()) {
    textEl.innerText = licenseText;
  } else {
    textEl.innerText = '';
  }
});

const frameRateElement = document.getElementById('frame-rate') as HTMLElement;
if (showFrameRate) {
  frameRateElement.style.display = 'flex';
}
const recIndicatorElement = document.getElementById('rec-indicator') as HTMLElement;
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
  'v': startStopVideo,
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

// const devicePixelRatio = window.devicePixelRatio;
canvas.style.width = canvas.clientWidth + 'px';
canvas.style.height = canvas.clientWidth * 9 / 16 + 'px';
canvas.width = 3840;
canvas.height = 2160;
// console.log(canvas.clientWidth, canvas.clientHeight);
// canvas.width = 3840;
// canvas.height = 2160;

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

const litPipeline: GPURenderPipeline = device.createRenderPipeline({
  label: 'lit pipeline',
  layout: device.createPipelineLayout({
    bindGroupLayouts: [litBindGroupLayout, cellStateBindGroupLayout],
  }),
  vertex: {
    module: litModule,
    buffers: [
      {
        arrayStride: 14 * 4,
        attributes: [
          {
            // position
            shaderLocation: 0,
            offset: 0,
            format: 'float32x3',
          },
          {
            // normal
            shaderLocation: 1,
            offset: 3 * 4,
            format: 'float32x3',
          },
          {
            // front color
            shaderLocation: 2,
            offset: 6 * 4,
            format: 'float32x3',
          },
          {
            // back color
            shaderLocation: 3,
            offset: 9 * 4,
            format: 'float32x3',
          },
          {
            // tubular coordinate
            shaderLocation: 4,
            offset: 12 * 4,
            format: 'float32',
          },
          {
            // radial coordinate
            shaderLocation: 5,
            offset: 13 * 4,
            format: 'float32',
          },
        ],
      },
    ],
  },
  fragment: {
    module: litModule,
    targets: [{ format: presentationFormat }],
  },
  primitive: {
    cullMode: 'none',
  },
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
  multisample: {
    count: msaaSampleCount,
  }
});

const wireframePipeline = bcWireframe
  // Barycentric coordinates based wireframe pipeline
  ? device.createRenderPipeline({
      label: 'barycentric coordinates based wireframe pipeline',
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
      multisample: {
        count: msaaSampleCount,
      },
    })
  // regular line-list based wireframe pipeline
  : device.createRenderPipeline({
      label: 'wireframe pipeline',
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
      multisample: {
        count: msaaSampleCount,
      },
    });

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

const videoWorker = new VideoWorker();
let savingVideo = false;
let videoQueueReady: Promise<void> | undefined;
let resolveVideoQueueReady: (() => void) | undefined;
const slomoFactor = 4;
let videoStartTime = 0;

async function startStopVideo() {
  if (savingVideo) {
    savingVideo = false;
    videoWorker.postMessage({ type: 'stop'});
    recIndicatorElement.style.display = 'none';
    videoOutputStartTime = 0;
  } else {
    try {
      const handle = await showSaveFilePicker({
        suggestedName: `kleinlife${new Date().toISOString()}.mp4`,
        types: [{
          description: 'Video File',
          accept: {'video/mp4' :['.mp4']}
        }],
      });
      savingVideo = true;
      recIndicatorElement.style.display = 'flex';
      videoWorker.postMessage({ type: 'start', handle });
      videoStartTime = performance.now();
    } catch (error) {
      // Probably the user aborted the save dialog, which is fine
      console.log('Error:', error);
      recIndicatorElement.style.display = 'flex';
      savingVideo = false;
    }
  }
}

videoWorker.addEventListener('message', (event) => {
  const { type, data } = event.data;
  switch (type) {
    case 'started':
      console.log('Video recording started');
      break;
    case 'stopped':
      const now = performance.now();
      console.log(`Video recording stopped. ${data?.frameCount || 0} frames recorded.`);
      console.log(`${(now - videoStartTime) / 1000} seconds elapsed`);
      console.log(`${(data?.frameCount || 0) / (now - videoStartTime) * 1000} frames encoded per second`);
      break;
    case 'queueFull':
      videoQueueReady = new Promise((resolve) => {
        resolveVideoQueueReady = resolve;
      });
      break;
    case 'queueNotFull':
      if (resolveVideoQueueReady) {
        videoQueueReady = undefined;
        resolveVideoQueueReady();
        resolveVideoQueueReady = undefined;
      }
      break;
    case 'error':
      console.error('Video worker error:', data?.error);
      savingVideo = false; // Reset recording state on error
      break;
    default:
      console.log('Message from worker:', event.data);
  }
});


let lastFrame: number | undefined;
let lastLifeStep: number | undefined;
let cameraPosition: CameraPosition | undefined;
let frameRateCounter = 0;
let lastFrameRateCheckpoint = 0;
let videoOutputStartTime = 0;
let ts = 0;
while (true) {
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
  // console.log(canvasTexture.width, canvasTexture.height);

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

  const renderPassDescriptor: GPURenderPassDescriptor = {
    label: 'our basic canvas renderPass',
    colorAttachments: [
      {
        view: (msaa ? multisampleTexture! : canvasTexture).createView(),
        resolveTarget: msaa ? canvasTexture.createView() : undefined,
        clearValue: [0, 0, 0, 1],
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
    depthStencilAttachment: {
      view: depthTexture.createView(),
      depthClearValue: 1.0,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  };

  const aspect = canvas.clientWidth / canvas.clientHeight;
  // For landscape aspect ratios, we use the vertical fov as specified. If the
  // window is not wide enough, we increase the fov to try to fit the whole
  // bottle in view at standard orbit distance.
  const fov = Math.max(
    (fovY * Math.PI) / 180,
    (fovY * 2 / 3 / aspect * Math.PI) / 180,
  );
  const projection = mat4.perspective(fov, aspect, clipNear, clipFar);

  let view: Float32Array;

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
    cameraPosition = moveCameraTowardsGoal(cameraPosition, goalCamera, deltaTime);
    if (cameraClose(cameraPosition, goalCamera)) {
      antModeTransition = false;
    }
  } else {
    cameraPosition = goalCamera;
  }
  view = mat4.lookAt(cameraPosition.eye, cameraPosition.target, cameraPosition.up);

  const viewProjection = mat4.multiply(projection, view);

  // make a command encoder to start encoding commands
  const encoder = device.createCommandEncoder();

  // make a render pass encoder to encode render specific commands
  const pass = encoder.beginRenderPass(renderPassDescriptor);
  pass.setPipeline(litPipeline);

  pass.setBindGroup(1, device.createBindGroup({
    label: 'Cell state bind group',
    layout: cellStateBindGroupLayout,
    entries: [{
      binding: 0,
      resource: { buffer: life.currentCellState },
    }],
  }));

  const world = mat4.identity();
  mat4.translate(world, translation, world);
  mat4.uniformScale(world, scale, world);

  mat4.multiply(viewProjection, world, worldViewProjectionMatrixValue);
  mat3.multiply(view, world, worldMatrixValue);
  mat3.invert(worldMatrixValue);
  mat3.transpose(worldMatrixValue);
  segmentsValues[0] = tubularSegments;
  segmentsValues[1] = radialSegments;
  wireBrightnessDistance[0] = Math.max(50, vec3.length(cameraPosition.eye));

  // Upload our uniform values.
  device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

  if (settings.faces) {
    pass.setVertexBuffer(0, model.vertexBuffer);
    pass.setIndexBuffer(model.indexBuffer, model.indexFormat);
    pass.setBindGroup(0, litBindGroup);
    pass.drawIndexed(model.vertexCount);
  }

  if (settings.edges) {
    pass.setPipeline(wireframePipeline);
    pass.setBindGroup(0, wireframeBindGroup);
    if (bcWireframe) {
      // The barycentric coordinates wireframe shaders draw triangles (although
      // most of the triangle is invisible, only pixels near the first two
      // edges are drawn), so we give it the full pixel count.
      pass.draw(model.vertexCount);
    } else {
      // In the "line-list" wireframe shaders, for each quad (2 triangles) we
      // have 6 vertex indices. We draw only two edges of the quad to make a
      // rectangular mesh (the other two are drawn by adjacent quads). Each
      // edge is 2 vertices, so we draw 4 vertices per quad.
      pass.draw(model.vertexCount * 4 / 6);
    }
  }

  pass.end();

  const commandBuffer = encoder.finish();
  device.queue.submit([commandBuffer]);
  // await device.queue.onSubmittedWorkDone();

  // Capture frame for video recording if active
  if (savingVideo) {
    if (!videoOutputStartTime) {
      videoOutputStartTime = ts;
    }
    // Apparently the way to get the results of the GPU render as a VideoFrame
    // is to grab it immediately after submitting the commands to the device.
    // If I wait for device.queue.onSubmittedWorkDone() or for the next
    // animation frame, apparently that is too late because the backing buffer
    // will have been cleared, and that's what is grabbed, I guess?
    const videoFrame = new VideoFrame(canvas, {
      timestamp: (ts - videoOutputStartTime) * 1000 * slomoFactor, // Convert to microseconds
    });
    if (videoQueueReady) {
      // console.log('Waiting for video queue to decrease');
      await videoQueueReady;
    }
    videoWorker.postMessage({
      type: 'frame',
      frame: videoFrame
    }, [videoFrame]);
    await new Promise((resolve) => setTimeout(resolve, 1));
  } else {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  ts += (1000 / 60 / slomoFactor);
}
