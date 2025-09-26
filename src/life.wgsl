// WebGPU compute shader for running Conway's Game of Life. Adapted from
// https://codelabs.developers.google.com/your-first-webgpu-app

@group(0) @binding(0) var<uniform> grid: vec2f;

@group(0) @binding(1) var<storage> cellStateIn: array<u32>;
@group(0) @binding(2) var<storage, read_write> cellStateOut: array<u32>;

fn cellIndex(cell: vec2u) -> u32 {
  let width = u32(grid.x);
  let height = u32(grid.y);
  // This modulo arithmetic only works because the dimensions are always powers of 2.
  // The numbers are unsigned 32-bit integers, which means 0 minus 1 is 2^(32)-1, which
  // is not equivalent to -1 in modulo arithmetic unless the modulus is a power of 2.
  // Using signed integers would not fix this because the % operator computes the
  // remainder, not modulo.
  // This could be fixed fairly easily to support any dimensions, but life.ts would need
  // changes too.
  let x = cell.x % width;
  let y = cell.y % height;
  if (cell.x >= width) {
    return ((height / 2 - 1 - y) % height) * width + x;
  }
  return y * width + x;
}

fn cellActive(x: u32, y: u32) -> u32 {
  return cellStateIn[cellIndex(vec2(x, y))];
}

@compute @workgroup_size(WORKGROUP_SIZE_X, WORKGROUP_SIZE_Y)
fn computeMain(@builtin(global_invocation_id) cell: vec3u) {
  // Determine how many active neighbors this cell has.
  let activeNeighbors = cellActive(cell.x+1, cell.y+1) +
                        cellActive(cell.x+1, cell.y) +
                        cellActive(cell.x+1, cell.y-1) +
                        cellActive(cell.x, cell.y-1) +
                        cellActive(cell.x-1, cell.y-1) +
                        cellActive(cell.x-1, cell.y) +
                        cellActive(cell.x-1, cell.y+1) +
                        cellActive(cell.x, cell.y+1);

  let i = cellIndex(cell.xy);

  // Conway's game of life rules:
  switch activeNeighbors {
    case 2: { // Active cells with 2 neighbors stay active.
      cellStateOut[i] = cellStateIn[i];
    }
    case 3: { // Cells with 3 neighbors become or stay active.
      cellStateOut[i] = 1;
    }
    default: { // Cells with < 2 or > 3 neighbors become inactive.
      cellStateOut[i] = 0;
    }
  }
}
