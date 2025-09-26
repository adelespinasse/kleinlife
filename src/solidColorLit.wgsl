// WebGPU shaders for drawing the filled-in quadrilaterals of the live Life
// cells, with a simple lighting model.

struct Uniforms {
  worldViewProjectionMatrix: mat4x4f,
  worldMatrix: mat4x4f,
  tubularSegments: u32,
  radialSegments: u32,
};

struct Vertex {
  @location(0) position: vec4f,
  @location(1) normal: vec3f,
  @location(2) front_color: vec3f,
  @location(3) back_color: vec3f,
  // TODO: Use integers for cell coordinates
  @location(4) tubular_coord: f32,
  @location(5) radial_coord: f32,
};

struct VSOut {
  @builtin(position) position: vec4f,
  @location(0) normal: vec3f,
  @location(1) front_color: vec3f,
  @location(2) back_color: vec3f,
  @location(3) tubular_coord: f32,
  @location(4) radial_coord: f32,
};

struct VSIn {
  @builtin(position) position: vec4f,
  @location(0) normal: vec3f,
  @location(1) front_color: vec3f,
  @location(2) back_color: vec3f,
  @location(3) tubular_coord: f32,
  @location(4) radial_coord: f32,
  @builtin(front_facing) is_front: bool,
};

@group(0) @binding(0) var<uniform> uni: Uniforms;

@group(1) @binding(0) var<storage> cellStates: array<u32>;

@vertex fn vs(vin: Vertex) -> VSOut {
  var vOut: VSOut;
  vOut.position = uni.worldViewProjectionMatrix * vin.position;
  vOut.normal = (uni.worldMatrix * vec4f(vin.normal, 0)).xyz;
  vOut.front_color = vin.front_color;
  vOut.back_color = vin.back_color;
  vOut.tubular_coord = vin.tubular_coord;
  vOut.radial_coord = vin.radial_coord;
  return vOut;
}

@fragment fn fs(vin: VSIn) -> @location(0) vec4f {
  let cellIndex = u32(vin.radial_coord) * uni.tubularSegments + u32(vin.tubular_coord);
  if (cellStates[cellIndex] == 0) {
    discard;
  }
  let lightDirection = normalize(vec3f(4, 10, 6));
  if (vin.is_front) {
    let light = dot(normalize(vin.normal), lightDirection) * 0.45 + 0.65;
    return vec4f(vin.front_color * light, 1.0);
  } else {
  // Reverse the normal for back faces so they look the same as front faces.
    let light = dot(normalize(-vin.normal), lightDirection) * 0.45 + 0.65;
    return vec4f(vin.back_color * light, 1.0);
  }
}
