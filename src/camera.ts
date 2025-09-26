import {
  mat4,
  vec3,
  type Vec3Arg,
} from 'wgpu-matrix';

/** Defines the location and position of a camera */
export type CameraPosition = {
  eye: Vec3Arg;
  target: Vec3Arg;
  up: Vec3Arg;
};

export const originCamera: CameraPosition = {
  eye: [0, 0, 0],
  target: [0, 0, -1],
  up: [0, 1, 0],
}

/** Returns a point on the line between start and end. The point's distance
 * from start is distance, unless that would put it past end, in which case end
 * is returned. */
function travelTowards(
  start: Vec3Arg,
  end: Vec3Arg,
  distance: number,
): Vec3Arg {
  const route = vec3.subtract(end, start);
  if (vec3.length(route) < distance) {
    return end;
  }
  const direction = vec3.normalize(route);
  vec3.scale(
    direction,
    distance,
    direction,
  );
  // Don't move further than the goal.
  return vec3.add(start, direction);
}

/** Returns a vector that is on the unit great circle defined by start and end,
 * and is rotated by the specified angle. */
function rotateTowards(
  start: Vec3Arg,
  end: Vec3Arg,
  radians: number,
) {
  const angle = vec3.angle(start, end);
  if (angle < radians) {
    return end;
  }
  let axis = vec3.cross(start, end);
  if (vec3.lengthSq(axis) < 0.0001) {
    // This means start and end are either almost the same or almost opposite,
    // so they don't accurately define a great circle. We look for a different
    // axis that is perpendicular to start.
    if (Math.abs(start[0]) < 0.8) {
      axis = vec3.cross(start, [1, 0, 0]);
    } else if (Math.abs(start[1]) < 0.8) {
      axis = vec3.cross(start, [0, 1, 0]);
    }
  }
  const rot = mat4.rotation(axis, radians);
  return vec3.normalize(vec3.transformMat4(start, rot));
}

/** Given the current and desired positions of a camera, returns a camera
 * position that is close to the current position, but moved slightly in the
 * direction of the desired position. Repeatedly calling this will (hopefully)
 * move the camera smoothly towards the desired position. If the current
 * position is undefined, the desired position is returned unmodified. */
export function moveCameraTowardsGoal(
  cameraPosition: CameraPosition | undefined,
  goalCamera: CameraPosition,
  deltaTime: number,
): CameraPosition {
  if (!cameraPosition) {
    return goalCamera;
  }
  const originDistance = vec3.length(cameraPosition.eye);

  // Move the camera eye position in a straight line towards the goal. Move
  // faster when further from the origin.
  const eye = travelTowards(
    cameraPosition.eye,
    goalCamera.eye,
    deltaTime * 0.0003 * Math.max(originDistance, 15),
  );

  // Move the camera's target in a straight line towards the goal. Move faster
  // when further from the origin. This is weird in terms of the effective
  // angle of the camera (you might expect to rotate at a constant rate,
  // instead of aiming at a point moving at a constant speed), but it has the
  // advantage of generally keeping the rendered object (centered at the
  // origin) in view when far from the origin.
  const target = travelTowards(
    cameraPosition.target,
    goalCamera.target,
    // slightly faster than the eye so it doesn't get behind
    deltaTime * 0.00031 * Math.max(originDistance, 15),
  );
  // If the target is too close to the eye, the direction won't be accurate
  // (worst case they're identical and we get a divide by zero). In that case
  // we instead keep the camera pointing in its current direction.
  if (vec3.distanceSq(eye, target) < 0.0001) {
    vec3.add(
      eye,
      vec3.subtract(cameraPosition.target, cameraPosition.eye),
      target,
    );
  }

  // Rotate the up vector at a constant rate until it reaches the goal. This is
  // not quite right; it could end up being too close to the direction of the
  // camera (or its opposite), which makes the calculations inaccurate and
  // could lead to a divide by zero.
  const up = rotateTowards(
    cameraPosition.up,
    goalCamera.up,
    0.0004 * deltaTime,
  );

  return { eye, target, up };
}

/** Returns true if the two camera positions are close enough that we can
 * consider the transition to be complete. */
export function cameraClose(
  camera1: CameraPosition,
  camera2: CameraPosition,
): boolean {
  if (vec3.distance(camera1.eye, camera2.eye) > 0.001) {
    return false;
  }
  if (vec3.distance(camera1.target, camera2.target) > 0.001) {
    return false;
  }
  if (vec3.distance(camera1.up, camera2.up) > 0.0001) {
    return false;
  }
  return true;
}