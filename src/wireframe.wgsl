// WebGPU shaders for drawing the wireframe

// The code in this file was originally from
// https://webgpu.github.io/webgpu-samples/?sample=wireframe
// and licensed under the BSD 3-Clause "Revised" license (2019).
// It has been modified and extended by Alan deLespinasse.

struct Uniforms {
  worldViewProjectionMatrix: mat4x4f,
  worldMatrix: mat4x4f,
  tubularSegments: u32,
  radialSegments: u32,
  // Lines that are closer are drawn brighter. This is the distance that is drawn
  // at average brightness. It is modified based on the camera position.
  wireBrightnessDistance: f32,
};

struct VSOut {
  @builtin(position) position: vec4f,
  @location(0) distance: f32,
};

@group(0) @binding(0) var<uniform> uni: Uniforms;
@group(0) @binding(1) var<storage, read> positions: array<f32>;
@group(0) @binding(2) var<storage, read> indices: array<u32>;

@vertex fn vsIndexedU32(@builtin(vertex_index) vNdx: u32) -> VSOut {
  // For each quad (2 triangles) we have 6 vertex indices. We draw only two edges
  // of the quad to make a rectangular mesh (the other two are drawn by adjacent quads).
  // Each edge is 2 vertices, so we draw 4 vertices per quad. This shader is called
  // for each of those vertices with a different value of vNdx. So for
  // vNdx = 4 * quadNdx + [0,1,2,3] we use vertex index 6 * quadNdx + [0,1,0,2].
  let quadNdx = vNdx / 4;
  let indexInQuad = vNdx % 4;     //  cycles through 0 1 2 3
  let x = indexInQuad % 2;        //  cycles through 0 1 0 1
  let y = u32(indexInQuad == 3);  //  cycles through 0 0 0 1
  let pointNdx = quadNdx * 6 + x + y; // 0, 1, 0, 2, 6, 7, 6, 8, 12, 13, 12, 14, ...
  let index = indices[pointNdx];

  // Vertex buffer is same format as in solidColorLit.wgsl, but we only use position here.
  let pNdx = index * 14;
  let position = vec4f(positions[pNdx], positions[pNdx + 1], positions[pNdx + 2], 1);

  var vOut: VSOut;
  vOut.position = uni.worldViewProjectionMatrix * position;
  vOut.distance = vOut.position.z;
  return vOut;
}

@fragment fn fs(vIn: VSOut) -> @location(0) vec4f {
  return vec4f(max(0.2, 0.6 - (vIn.distance - uni.wireBrightnessDistance) * 0.008));
}
