import lifeShaderCode from './life.wgsl?raw';

const WORKGROUP_SIZE = 8;

function isPowerOf2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0 && n === Math.floor(n);
}

/** Runs the Conway's Game of Life algorithm on the GPU. */
export class ToroidalLife {
  device: GPUDevice;
  grid_size_x: number;
  grid_size_y: number;
  workgroup_size_x: number;
  workgroup_size_y: number;
  pipeline: GPUComputePipeline;
  bindGroups: GPUBindGroup[];
  cellStateStorage: GPUBuffer[];
  currentCellState: GPUBuffer;
  step: number;
  cellStateArray: Uint32Array<ArrayBuffer>; // Used only when (re)initializing grid

  constructor(
    device: GPUDevice,
    tubularSegments: number,
    radialSegments: number,
  ) {
    // Dimensions have to be powers of 2 AT LEAST because of the implementation
    // of setCell below and the cellIndex function in life.wgsl. There might be
    // other reasons too.
    if (!isPowerOf2(tubularSegments) || !isPowerOf2(radialSegments)) {
      throw new Error('Grid dimensions must be powers of 2');
    }
    this.device = device;
    this.grid_size_x = tubularSegments;
    this.grid_size_y = radialSegments;
    this.workgroup_size_x = Math.min(WORKGROUP_SIZE, this.grid_size_x);
    this.workgroup_size_y = Math.min(WORKGROUP_SIZE, this.grid_size_y)
    this.step = 0;
    this.cellStateArray = new Uint32Array(this.grid_size_x * this.grid_size_y);

    // Create the bind group layout and pipeline layout.
    const bindGroupLayout = this.device.createBindGroupLayout({
      label: "Cell Bind Group Layout",
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
        buffer: {} // Grid uniform buffer
      }, {
        binding: 1,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" } // Cell state input buffer
      }, {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" } // Cell state output buffer
      }]
    });

    const pipelineLayout = this.device.createPipelineLayout({
      label: "Cell Pipeline Layout",
      bindGroupLayouts: [ bindGroupLayout ],
    });

    // Create the compute shader that will process the game of life simulation.
    const lifeShaderModule = this.device.createShaderModule({
      label: "Life simulation shader",
      code: lifeShaderCode.replace(/\bWORKGROUP_SIZE_X\b/g, String(this.workgroup_size_x))
        .replace(/\bWORKGROUP_SIZE_Y\b/g, String(this.workgroup_size_y))
    });

    // Create a compute pipeline that updates the game state.
    this.pipeline = this.device.createComputePipeline({
      label: "Simulation pipeline",
      layout: pipelineLayout,
      compute: {
        module: lifeShaderModule,
        entryPoint: "computeMain",
      }
    });

    // Create a uniform buffer that describes the grid.
    const uniformArray = new Float32Array([this.grid_size_x, this.grid_size_y]);
    const uniformBuffer = this.device.createBuffer({
      label: "Grid Uniforms",
      size: uniformArray.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(uniformBuffer, 0, uniformArray);

    // Create two storage buffers to hold the cell state.
    this.cellStateStorage = [
      this.device.createBuffer({
        label: "Cell State A",
        size: this.grid_size_x * this.grid_size_y * Uint32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
      this.device.createBuffer({
        label: "Cell State B",
        size: this.grid_size_x * this.grid_size_y * Uint32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      })
    ];
    this.currentCellState = this.cellStateStorage[0];
    this.setRandom(.3);
    // this.setOneGlider();

    // Create a bind group to pass the grid uniforms into the pipeline
    this.bindGroups = [
      this.device.createBindGroup({
        label: "Cell renderer bind group A",
        layout: bindGroupLayout,
        entries: [{
          binding: 0,
          resource: { buffer: uniformBuffer }
        }, {
          binding: 1,
          resource: { buffer: this.cellStateStorage[0] }
        }, {
          binding: 2,
          resource: { buffer: this.cellStateStorage[1] }
        }],
      }),
      this.device.createBindGroup({
        label: "Cell renderer bind group B",
        layout: bindGroupLayout,
        entries: [{
          binding: 0,
          resource: { buffer: uniformBuffer }
        }, {
          binding: 1,
          resource: { buffer: this.cellStateStorage[1] }
        }, {
          binding: 2,
          resource: { buffer: this.cellStateStorage[0] }
        }],
      }),
    ];
  }

  clear() {
    this.cellStateArray.fill(0);
  }

  setCell(x: number, y: number, state = 1) {
    // Calculate absolute coordinates that lie within [0, width) and [0,
    // height). If 2*N*width <= x < (2*N+1)*width, for integer N, this means we
    // have to invert y to implement the "twist" in the bottle surface. The &
    // operator works for this only because the grid dimensions have to be
    // powers of 2.
    const y0 = ((x & this.grid_size_x)
      ? this.grid_size_y / 2 - 1 - y
      : y) & (this.grid_size_y - 1);
    const x0 = x & (this.grid_size_x - 1);
    this.cellStateArray[y0 * this.grid_size_x + x0] = state;
  };

  makeGlider(x: number, y: number, phase = 0, xdir = 1, ydir = 1) {
    // TODO: This only implements 2 of the 4 phases for each direction
    if (!(phase & 1)) {
      this.setCell(x, y);
      this.setCell(x, y + ydir);
      this.setCell(x, y + 2 * ydir);
      this.setCell(x - xdir, y + 2 * ydir);
      this.setCell(x - 2 * xdir, y + ydir);
    } else {
      this.setCell(x - 2 * xdir, y + 2 * ydir);
      this.setCell(x - xdir, y + 2 * ydir);
      this.setCell(x - xdir, y + ydir);
      this.setCell(x, y + ydir);
      this.setCell(x - 2 * xdir, y);
    }
  };

  /** Draws a stripe that goes all the way around twice, because it doesn't
   * join up with itself the first time around. */
  drawXStripe(y: number) {
    for (let x = 0; x < 2 * this.grid_size_x; x++) {
      this.setCell(x, y);
    }
  }

  drawYStripe(x: number) {
    for (let y = 0; y < this.grid_size_y; y++) {
      this.setCell(x, y);
    }
  }

  upload() {
    this.device.queue.writeBuffer(this.currentCellState, 0, this.cellStateArray);
  }

  setRandom(fraction: number) {
    this.clear();
    for (let index = 0; index < this.cellStateArray.length; index++) {
      this.cellStateArray[index] = Math.random() < fraction ? 1 : 0;
    }
    this.upload();
  }

  /** Within each 8x8 square, with probability `fraction`, create a glider. The
   * glider's direction, phase, and position within the 8x8 square are random,
   * but it doesn't touch the edge of the square. */
  setRandomGliders(fraction: number) {
    this.clear();
    for (let x = 0; x < this.grid_size_x; x += 8) {
      for (let y = 0; y < this.grid_size_y; y += 8) {
        if (Math.random() < fraction) {
          this.makeGlider(
            x + 2 + Math.floor(Math.random() * 4),
            y + 2 + Math.floor(Math.random() * 4),
            Math.floor(Math.random() * 4),
            Math.floor(Math.random() * 2) * 2 - 1,
            Math.floor(Math.random() * 2) * 2 - 1,
          );
        }
      }
    }
    this.upload();
  }

  setOneGlider() {
    this.clear();
    this.makeGlider(2, 10, 0, -1, -1);
    this.upload();
  }

  setXStripes() {
    this.clear();
    for (let y = 0; y < this.grid_size_y / 4; y +=2) {
      this.drawXStripe(y);
      this.drawXStripe(y + this.grid_size_y / 2 - 1);
    }
    this.upload();
  }

  setYStripes() {
    this.clear();
    for (let x = 0; x < this.grid_size_x; x += 2) {
      this.drawYStripe(x);
    }
    this.upload();
  }

  setRandomXStripes(fraction: number = 0.2) {
    this.clear();
    for (let y = 0; y < this.grid_size_y; y++) {
      if (Math.random() < fraction / 2) {
        this.drawXStripe(y);
      }
    }
    this.upload();
  }

  setRandomYStripes(fraction: number = 0.2) {
    this.clear();
    for (let x = 0; x < this.grid_size_x; x++) {
      if (Math.random() < fraction) {
        this.drawYStripe(x);
      }
    }
    this.upload();
  }

  setSquares() {
    this.clear();
    for (let y = 0; y < this.grid_size_y - 2; y += 3) {
      for (let x = 0; x < this.grid_size_x - 2; x += 3) {
        this.setCell(x + 0, y + 0);
        this.setCell(x + 1, y + 0);
        this.setCell(x + 1, y + 1);
        this.setCell(x + 0, y + 1);
      }
    }
    this.upload();
  }

  setEmpty() {
    this.clear();
    this.upload();
  }

  setFull() {
    for (let x = 0; x < this.grid_size_x; x++) {
      this.drawYStripe(x);
    }
    this.upload();
  }

  update() {
    const encoder = this.device.createCommandEncoder();

    // Compute pass
    const computePass = encoder.beginComputePass();
    computePass.setPipeline(this.pipeline);
    computePass.setBindGroup(0, this.bindGroups[this.step % 2]);
    computePass.dispatchWorkgroups(
      Math.ceil(this.grid_size_x / this.workgroup_size_x),
      Math.ceil(this.grid_size_y / this.workgroup_size_y),
    );
    computePass.end();

    this.step++; // Increment the step count
    this.device.queue.submit([encoder.finish()]);

    this.currentCellState = this.cellStateStorage[this.step % 2];
    // this.clear();
    // this.drawXStripe(this.step);
    // this.upload();
  }
}
