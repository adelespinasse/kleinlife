import {
  mat3,
  vec3,
} from 'wgpu-matrix';

// Klein bottle parameterizations. In general, you pass in values of u and v
// and the function returns [x, y, z] coordinates. If [u,v] pairs cover the
// square from [0, 0] to [2*pi, 2*pi], the returned coordinates make a complete
// Klein bottle (or, in a couple cases, some other shape). Each function takes
// different additional arguments to modify the shape in different ways.

// Parameters for kleinBottleWikipedia function below. I really don't
// understand most of these. The narrow part of the neck gets wider when you
// increase a (the wide part increases too but not as much). xfac, yfac, and
// zfac control scaling in each dimension.
type WikipediaParams = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  g: number;
  xfac: number;
  yfac: number;
  zfac: number;
};

// Bottle shape from https://en.wikipedia.org/wiki/Klein_bottle#Bottle_shape.
// The narrow part is extremely narrow if you use the original coefficients.
function kleinBottleWikipedia(
  u: number,
  v: number,
  tubeRadius: number,
  params: Partial<WikipediaParams> = {},
): [number, number, number] {
  const { a, b, c, d, e, f, g, xfac, yfac, zfac } = {
    // Original coefficients shown on Wikipedia.
    a: 3, b: 30, c: 90, d: 60, e: 5, f: 48, g: 80,
    xfac: -2/15 * tubeRadius, yfac: -1/15 * tubeRadius, zfac: 2/15 * tubeRadius,
    ...params,
  };
  const sinu = Math.sin(u / 2); // u is from 0 to pi in Wikipedia formula
  const cosu = Math.cos(u / 2);
  const sinv = Math.sin(v);
  const cosv = Math.cos(v);
  return [
    xfac * cosu * (
      a * cosv
      - b * sinu
      + c * Math.pow(cosu, 4) * sinu
      - d * Math.pow(cosu, 6) * sinu
      + e * cosu * cosv * sinu
    ) + 1.2 * xfac, // center on x axis
    yfac * sinu * (
      a * cosv
      - a * Math.pow(cosu, 2) * cosv
      - f * Math.pow(cosu, 4) * cosv
      + f * Math.pow(cosu, 6) * cosv
      - d * sinu
      + e * cosu * cosv * sinu
      - e * Math.pow(cosu, 3) * cosv * sinu
      - g * Math.pow(cosu, 5) * cosv * sinu
      + g * Math.pow(cosu, 7) * cosv * sinu
    ) + 30 * yfac, // center on y axis
    zfac * (a + e * cosu * sinu) * sinv
  ];
}

// The Wikipedia parameterization, but wider at the narrowest part of the tube.
// This is the best version I've managed.
function kleinBottleWikipediaImproved(
  u: number, v: number, tubeRadius: number,
): [number, number, number] {
  return kleinBottleWikipedia(u, v, tubeRadius, { a: 8 });
}

// Bottle shape from https://mathcurve.com/surfaces.gb/klein/klein.shtml.
// Pretty decent classic bottle shape, except for a sort of abrupt "corner" on
// the wider side.
function kleinBottleMathcurve(
  u: number, v: number,
  ringRadius: number, tubeRadius: number,
): [number, number, number] {
  const a = ringRadius / 3, b = ringRadius / 2, c = tubeRadius * 2 / 3;
  const ru = c * (1 - Math.cos(u) / 2);
  if (u < Math.PI) {
    return [
      (a * (1 + Math.sin(u)) + ru * Math.cos(v)) * Math.cos(u),
      (b + ru * Math.cos(v)) * Math.sin(u),
      ru * Math.sin(v),
    ];
  } else {
    return [
      a * (1 + Math.sin(u)) * Math.cos(u) - ru * Math.cos(v),
      b * Math.sin(u),
      ru * Math.sin(v),
    ];
  };
}

// Figure 8 immersion.
function kleinBottleFigure8(
  u: number, v: number,
  ringRadius: number, tubeRadius: number,
): [number, number, number] {
  // The modification of v here rotates the whole thing around the circular
  // "axis" of the tube, which makes the "twisted" ends of the plane match up
  // with each other correctly in the Life implementation. It might have made
  // more sense to do the opposite in the bottle-shaped versions; then I think
  // the Life implementation in life.wgsl could have just done a simple
  // inversion of the y coordinates at the ends, i.e. y = height - 1 - y
  // instead of y = height / 2 - 1 - y.
  const v1 = v + Math.PI / 2;
  const r = ringRadius / tubeRadius;
  const cosu2sinv = Math.cos(u / 2) * Math.sin(v1);
  const sinu2sin2v = Math.sin(u / 2) * Math.sin(2 * v1);
  const rad = r + cosu2sinv - sinu2sin2v;
  const x = rad * Math.cos(u);
  const z = rad * Math.sin(u);
  const y = Math.sin(u/2) * Math.sin(v1) + Math.cos(u / 2) * Math.sin(2 * v1);
  return [x * tubeRadius, y * tubeRadius, z * tubeRadius];
}

// Torus (i.e., not a Klein bottle).
function torus(
  u: number, v: number,
  ringRadius: number, tubeRadius: number,
): [number, number, number] {
  const circle = [
    ringRadius + tubeRadius * Math.cos(v),
    tubeRadius * Math.sin(v),
    0,
  ];
  const rot = mat3.rotationY(u);
  const pos: [number, number, number] = [0, 0, 0];
  vec3.transformMat3(circle, rot, pos);
  return pos;
}

// Torus that gets pinched together and inverted at one spot, so it is
// effectively a Klein bottle.
function pinchedTorus(
  u: number, v: number,
  ringRadius: number, tubeRadius: number,
): [number, number, number] {
  // See explanation of the modification of v in kleinBottleFigure8 above.
  const [x, y, z] = torus(u, v + Math.PI / 2, ringRadius, tubeRadius);
  return [x, Math.pow(Math.abs(Math.sin(u / 2)), 0.5) * y, z];
}

// Claude's cool-looking failed attempt.
function bigSail(
  u: number, v: number,
  ringRadius: number, tubeRadius: number,
): [number, number, number] {
  return [
    (ringRadius + tubeRadius * Math.cos(v / 2) * Math.sin(u) - tubeRadius * Math.sin(v / 2) * Math.sin(2 * u)) - 10,
    (tubeRadius * Math.sin(v / 2) + tubeRadius * Math.cos(v / 2) * Math.cos(2 * u)),
    (tubeRadius * Math.cos(v / 2) * Math.cos(u) - tubeRadius * Math.sin(v / 2) * Math.cos(2 * u)),
  ];
}

// Just a rectangle, so you get a "flattened" bottle.
function rectangle(
  u: number, v: number,
  ringRadius: number, tubeRadius: number,
): [number, number, number] {
  return [ringRadius * (u - Math.PI), tubeRadius * (v - Math.PI), 0];
}

// Really long tube, so we can pretend it's infinite. Best with x=2048&y=64.
function tube(u: number, v: number): [number, number, number] {
  return [200 * (u - Math.PI), 5 * Math.sin(v), 5 * Math.cos(v)];
}

// Klein bottle coordinates for a parameterization specified by name. This
// chooses different convenient shape parameters for each version to make them
// come out an appropriate size for the default camera position.
function kleinBottleCoord(
  u: number, v: number,
  immersion: string,
): [number, number, number] {
  switch (immersion) {
    case 'mathcurve':
        return kleinBottleMathcurve(u, v, 10, 3);
    case 'figure8':
        return kleinBottleFigure8(u, v, 8, 2);
    case 'torus':
        return torus(u, v, 8, 3);
    case 'pinched':
        return pinchedTorus(u, v, 8, 3);
    case 'bigsail':
        return bigSail(u, v, 10, 3);
    case 'rectangle':
      return rectangle(u, v, 4, 2);
    case 'tube':
      return tube(u, v);
    case 'wiki':
      return kleinBottleWikipedia(u, v, 3);
    case 'best':
    case 'wikiimproved':
    default:
      return kleinBottleWikipediaImproved(u, v, 3);
  }
}

// Calculates the tangent vector in the u direction at a given spot on a model.
export function kleinBottleTangentU(
  u: number, v: number,
  immersion: string,
  epsilon: number = 0.001
): [number, number, number] {
  const pos1 = kleinBottleCoord(u - epsilon, v, immersion);
  const pos2 = kleinBottleCoord(u + epsilon, v, immersion);
  return vec3.normalize(vec3.subtract(pos2, pos1));
}

// Calculates the tangent vector in the v direction at a given spot on a model.
export function kleinBottleTangentV(
  u: number, v: number,
  immersion: string,
  epsilon: number = 0.001
): [number, number, number] {
  const pos1 = kleinBottleCoord(u, v - epsilon, immersion);
  const pos2 = kleinBottleCoord(u, v + epsilon, immersion);
  return vec3.normalize(vec3.subtract(pos2, pos1));
}

// Calculates the normal vector at a given spot on a model.
function kleinBottleNormal(
  u: number,
  v: number,
  immersion: string,
  uEpsilon: number,
  vEpsilon: number,
) {
  const tangentU = kleinBottleTangentU(u, v, immersion, uEpsilon);
  const tangentV = kleinBottleTangentV(u, v, immersion, vEpsilon);
  return vec3.normalize(vec3.cross(tangentU, tangentV));
}

// Export the coordinate function for use by camera animation
export { kleinBottleCoord };

// Converts color specified as HSV (hue/saturation/value) to RGB values, with a
// fudge factor to make yellow/green a little dimmer and blue/violet a little
// brighter, for the color wheel coloring scheme.
function hsvToRgb(h: number, s: number, v0: number): [number, number, number] {
  // Brightness fudge factor
  const v = v0 - 0.15 * Math.cos((h - 1.3 / 6) * 2 * Math.PI);
  let r = 0, g = 0, b = 0;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: r = v, g = t, b = p; break;
    case 1: r = q, g = v, b = p; break;
    case 2: r = p, g = v, b = t; break;
    case 3: r = p, g = q, b = v; break;
    case 4: r = t, g = p, b = v; break;
    case 5: r = v, g = p, b = q; break;
  }
  return [r, g, b];
}

/** Converts e.g. 'ff0033' to [1, 0, 0.2] */
function hexToRgb(
  hexColor: string | null,
): [number, number, number] | undefined {
  if (!hexColor || hexColor.length !== 6) {
    return undefined;
  }
  return [
    Number.parseInt(hexColor.slice(0, 2), 16) / 255,
    Number.parseInt(hexColor.slice(2, 4), 16) / 255,
    Number.parseInt(hexColor.slice(4, 6), 16) / 255,
  ];
}

/**Returns a complete Klein bottle model in the specified shape, in the format
 * needed by the WebGPU shaders (for each vertex, it includes position, normal,
 * front color, back color, and [i,j] coordinates on the Life grid).
 *
 * @param{number} hexColor can be a 6-character string in hex format, i.e. 'FFAA88'. If it
 * can't be parsed that way, a rainbow color scheme is used. */
export function kleinBottle(
  tubularSegments: number,
  radialSegments: number,
  immersion: string,
  hexColor: string | null = null,
) {
  const color = hexToRgb(hexColor);
  const vertices: number[] = [];
  const indices: number[] = [];
  const uStep = (1 / tubularSegments) * Math.PI * 2;
  const vStep = (1 / radialSegments) * Math.PI * 2;
  const uEpsilon = uStep * .1;
  const vEpsilon = vStep * .1;

  for (let j = 0; j <= radialSegments; ++j) {
    for (let i = 0; i <= tubularSegments; ++i) {
      const u = (i / tubularSegments) * Math.PI * 2;
      const v = (j / radialSegments) * Math.PI * 2;

      const vertex = kleinBottleCoord(u, v, immersion);
      const normal = kleinBottleNormal(u, v, immersion, uEpsilon, vEpsilon);
      const frontColor = color || hsvToRgb(i / tubularSegments / 2, 0.5, 0.85);
      const backColor = color || hsvToRgb(i / tubularSegments / 2 + 0.5, 0.5, 0.85);
      vertices.push(...vertex);
      vertices.push(...normal);
      vertices.push(...frontColor);
      vertices.push(...backColor);
      vertices.push(i, j);
    }
  }

  for (let j = 0; j < radialSegments; j += 1) {
    for (let i = 0; i < tubularSegments; i += 1) {
      const a = (tubularSegments + 1) * j + i + 1;
      const b = (tubularSegments + 1) * (j + 1) + i + 1;
      const c = (tubularSegments + 1) * (j + 1) + i;
      const d = (tubularSegments + 1) * j + i;

      // faces
      indices.push(a, b, d);
      indices.push(c, d, b);
    }
  }

  return {
    vertices: Float32Array.from(vertices),
    indices: Uint32Array.from(indices),
  };
}
