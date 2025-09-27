// WebGPU shaders for drawing the wireframe

// The code in this file was originally from
// https://webgpu.github.io/webgpu-samples/?sample=wireframe
// and licensed under the BSD 3-Clause "Revised" license (2019).
// It has been modified and extended by Alan deLespinasse.

// Uniforms and storage used by both wireframe rendering methods.
struct Uniforms {
  worldViewProjectionMatrix: mat4x4f,
  worldMatrix: mat4x4f,
  tubularSegments: u32,
  radialSegments: u32,
  // Lines that are closer are drawn brighter. This is the distance that is drawn
  // at average brightness. It is modified based on the camera position.
  wireBrightnessDistance: f32,
};

@group(0) @binding(0) var<uniform> uni: Uniforms;
@group(0) @binding(1) var<storage, read> positions: array<f32>;
@group(0) @binding(2) var<storage, read> indices: array<u32>;


// Normal line-list wireframe shaders.

struct VSOut {
  @builtin(position) position: vec4f,
  @location(0) distance: f32,
};

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
  // Lines are grey, with brightness determined by distance.
  return vec4f(max(0.2, 0.6 - (vIn.distance - uni.wireBrightnessDistance) * 0.008));
}


// Barycentric coordinates based wireframe shaders.

struct LineUniforms {
  width: f32,
  alphaThreshold: f32,
};

@group(0) @binding(3) var<uniform> line: LineUniforms;

struct bcVSOutput {
  @builtin(position) position: vec4f,
  @location(0) barycenticCoord: vec3f,
  @location(1) distance: f32,
};

@vertex fn vsIndexedU32bcLines(
  @builtin(vertex_index) vNdx: u32
) -> bcVSOutput {
  let vertNdx = vNdx % 3;
  let index = indices[vNdx];

  let pNdx = index * 14; // Stride in 4-byte words
  let position = vec4f(positions[pNdx], positions[pNdx + 1], positions[pNdx + 2], 1);

  var vOut: bcVSOutput;
  vOut.position = uni.worldViewProjectionMatrix * position;

  // emit a barycentric coordinate
  vOut.barycenticCoord = vec3f(0);
  vOut.barycenticCoord[vertNdx] = 1.0;
  vOut.distance = vOut.position.z;
  return vOut;
}

fn edgeFactor(bary: vec3f) -> f32 {
  let d = fwidth(bary);
  let a3 = smoothstep(vec3f(0.0), d * line.width, bary);
  return min(a3.y, a3.z); // ignoring a3.x removes the diagonal lines in each square
}

@fragment fn fsbcLines(
  vIn: bcVSOutput
) -> @location(0) vec4f {
  // Pixels are only drawn near the first two edges. The edge factor fades out as it
  // gets further from the edge for an antialiasing effect.
  let a = 1.0 - edgeFactor(vIn.barycenticCoord);
  if (a < line.alphaThreshold) {
    // Don't bother drawing pixels that are very close to invisible.
    discard;
  }

  // Lines are grey, with brightness determined by distance. Alpha is also set to a so that
  // we get some antialiasing effect even when the line is drawn on top of filled-in cells.
  return vec4(vec3(a, a, a) * max(0.2, 0.6 - (vIn.distance - uni.wireBrightnessDistance) * 0.008), a);
}
