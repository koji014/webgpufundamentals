import triangle_wgsl from '../shaders/index.wgsl';

interface ChangingStorageOffsets {
  scale: number;
}

interface ObjectInfo {
  scale: number;
}

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly pipeline: GPURenderPipeline;
  private readonly changingStorageBuffer: GPUBuffer;
  private readonly storageValues: Float32Array<ArrayBuffer>;
  private readonly changingUnitSize: number;
  private readonly changingOffsets: ChangingStorageOffsets;
  private readonly bindGroup: GPUBindGroup;
  private readonly numObjects: number;
  private readonly numVertices: number;
  private readonly objectInfos: ObjectInfo[];
  private readonly colorAttachment: GPURenderPassColorAttachment;
  private readonly renderPassDescriptor: GPURenderPassDescriptor;
  private observer?: ResizeObserver;

  private constructor(fields: {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    pipeline: GPURenderPipeline;
    changingStorageBuffer: GPUBuffer;
    storageValues: Float32Array<ArrayBuffer>;
    changingUnitSize: number;
    changingOffsets: ChangingStorageOffsets;
    bindGroup: GPUBindGroup;
    numObjects: number;
    numVertices: number;
    objectInfos: ObjectInfo[];
    colorAttachment: GPURenderPassColorAttachment;
    renderPassDescriptor: GPURenderPassDescriptor;
  }) {
    this.canvas = fields.canvas;
    this.device = fields.device;
    this.context = fields.context;
    this.pipeline = fields.pipeline;
    this.changingStorageBuffer = fields.changingStorageBuffer;
    this.storageValues = fields.storageValues;
    this.changingUnitSize = fields.changingUnitSize;
    this.changingOffsets = fields.changingOffsets;
    this.bindGroup = fields.bindGroup;
    this.numObjects = fields.numObjects;
    this.numVertices = fields.numVertices;
    this.objectInfos = fields.objectInfos;
    this.colorAttachment = fields.colorAttachment;
    this.renderPassDescriptor = fields.renderPassDescriptor;
  }

  static async create(canvas: HTMLCanvasElement): Promise<App> {
    const device = await App.getDevice();

    const context = canvas.getContext('webgpu');
    if (!context) {
      throw new Error('webgpu コンテキストを取得できませんでした。');
    }

    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: presentationFormat });

    const shaderModule = device.createShaderModule({
      label: 'storage buffer vertices with normal/uv',
      code: triangle_wgsl,
    });

    const pipeline = device.createRenderPipeline({
      label: 'triangle with uniforms',
      layout: 'auto',
      vertex: {
        module: shaderModule,
      },
      fragment: {
        module: shaderModule,
        targets: [{ format: presentationFormat }],
      },
    });

    const numObjects = 100;
    const objectInfos: ObjectInfo[] = [];

    // uniforms のためのバッファを作成する
    const staticUnitSize =
      4 * 4 + // color is 4 32bit floats (4bytes each): vec4f
      2 * 4 + // offset is 2 32bit floats (4bytes each): vec2f
      2 * 4; // padding
    const changingUnitSize = 2 * 4; // scale is 2 32bit floats (4bytes each): vec2f

    const staticStorageBufferSize = staticUnitSize * numObjects;
    const changingStorageBufferSize = changingUnitSize * numObjects;

    const staticStorageBufferOffsets = {
      color: 0,
      offset: 4,
    };

    const changingOffsets = {
      scale: 0,
    };

    const staticStorageBuffer = device.createBuffer({
      label: 'static storage for objects',
      size: staticStorageBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const changingStorageBuffer = device.createBuffer({
      label: 'changing storage for objects',
      size: changingStorageBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    {
      const staticStorageValues = new Float32Array(staticStorageBufferSize / 4);
      for (let i = 0; i < numObjects; i++) {
        const staticOffset = i * (staticUnitSize / 4);

        staticStorageValues.set(
          [App.rand(), App.rand(), App.rand(), 1],
          staticOffset + staticStorageBufferOffsets.color,
        );
        staticStorageValues.set(
          [App.rand(-0.9, 0.9), App.rand(-0.9, 0.9)],
          staticOffset + staticStorageBufferOffsets.offset,
        );

        objectInfos.push({
          scale: App.rand(0.2, 0.5),
        });
      }
      device.queue.writeBuffer(staticStorageBuffer, 0, staticStorageValues);
    }

    const storageValues = new Float32Array(changingStorageBufferSize / 4);

    const { vertexData, numVertices } = App.createCircleVertices({
      radius: 0.5,
      innerRadius: 0.25,
    });

    const vertexStorageBuffer = device.createBuffer({
      label: 'storage buffer vertices',
      size: vertexData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexStorageBuffer, 0, vertexData);

    const bindGroup = device.createBindGroup({
      label: 'bind group for objects',
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: staticStorageBuffer },
        { binding: 1, resource: changingStorageBuffer },
        { binding: 2, resource: vertexStorageBuffer },
      ],
    });

    const colorAttachment: GPURenderPassColorAttachment = {
      view: undefined as unknown as GPUTextureView,
      clearValue: [0.3, 0.3, 0.3, 1],
      loadOp: 'clear',
      storeOp: 'store',
    };

    const renderPassDescriptor: GPURenderPassDescriptor = {
      label: 'our basic canvas renderPass',
      colorAttachments: [colorAttachment],
    };

    const app = new App({
      canvas,
      device,
      context,
      pipeline,
      changingStorageBuffer,
      storageValues,
      changingUnitSize,
      changingOffsets,
      bindGroup,
      numObjects,
      numVertices,
      objectInfos,
      colorAttachment,
      renderPassDescriptor,
    });

    device.lost.then(async (info) => {
      console.error(`WebGPU device was lost: ${info.message}`);
      if (info.reason !== 'destroyed') {
        app.dispose();
        const next = await App.create(canvas);
        next.start();
      }
    });

    return app;
  }

  start() {
    this.observer = new ResizeObserver((entries) => this.resize(entries));
    this.observer.observe(this.canvas);
  }

  dispose() {
    this.observer?.disconnect();
    this.observer = undefined;
  }

  private render() {
    const currentTexture = this.context.getCurrentTexture();
    this.colorAttachment.view = currentTexture.createView();

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass(this.renderPassDescriptor);
    pass.setPipeline(this.pipeline);

    const aspect = this.canvas.width / this.canvas.height;

    this.objectInfos.forEach(({ scale }, ndx) => {
      const offset = ndx * (this.changingUnitSize / 4);
      this.storageValues.set(
        [scale / aspect, scale],
        offset + this.changingOffsets.scale,
      );
    });
    this.device.queue.writeBuffer(
      this.changingStorageBuffer,
      0,
      this.storageValues,
    );

    pass.setBindGroup(0, this.bindGroup);
    pass.draw(this.numVertices, this.numObjects);

    pass.end();

    const commandBuffer = encoder.finish();
    this.device.queue.submit([commandBuffer]);
  }

  private resize(entries: ResizeObserverEntry[]) {
    for (const entry of entries) {
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;

      const maxSize = this.device.limits.maxTextureDimension2D;
      this.canvas.width = Math.max(1, Math.min(width, maxSize));
      this.canvas.height = Math.max(1, Math.min(height, maxSize));
    }
    this.render();
  }

  private static async getDevice(): Promise<GPUDevice> {
    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) {
      throw new Error('WebGPU対応ブラウザが必要です');
    }

    return device;
  }

  private static rand = (min?: number, max?: number) => {
    if (min === undefined) {
      min = 0;
      max = 1;
    } else if (max === undefined) {
      max = min;
      min = 0;
    }
    return min + Math.random() * (max - min);
  };

  private static createCircleVertices = ({
    radius = 1,
    numSubdivisions = 24,
    innerRadius = 0,
    startAngle = 0,
    endAngle = Math.PI * 2,
  } = {}) => {
    // 1つのサブディビジョンあたり2つの三角形、1つの三角形あたり3つの頂点。
    const numVertices = numSubdivisions * 2 * 3;
    // 1 頂点 = 12 個の f32（= 48 バイト。うち position/normal/uv の実データは 7 個、残り 5 個はパディング）。
    const vertexData = new Float32Array(numSubdivisions * 2 * 3 * 12);

    let offset = 0;
    const addVertex = (
      x: number,
      y: number,
      nx: number,
      ny: number,
      nz: number,
      u: number,
      v: number,
    ) => {
      vertexData[offset++] = x; // position.x   (byte 0)
      vertexData[offset++] = y; // position.y   (byte 4)
      offset += 2; //             パディング     (byte 8-15)
      vertexData[offset++] = nx; // normal.x     (byte 16)
      vertexData[offset++] = ny; // normal.y     (byte 20)
      vertexData[offset++] = nz; // normal.z     (byte 24)
      offset += 1; //             パディング     (byte 28-31)
      vertexData[offset++] = u; //  uv.x         (byte 32)
      vertexData[offset++] = v; //  uv.y         (byte 36)
      offset += 2; //             末尾パディング (byte 40-47)
    };

    const nz = 0.5;

    // 1つのサブディビジョンあたり2つの三角形
    //
    // 0--1 4
    // | / /|
    // |/ / |
    // 2 3--5
    for (let i = 0; i < numSubdivisions; ++i) {
      const angle1 =
        startAngle + ((i + 0) * (endAngle - startAngle)) / numSubdivisions;
      const angle2 =
        startAngle + ((i + 1) * (endAngle - startAngle)) / numSubdivisions;

      const c1 = Math.cos(angle1);
      const s1 = Math.sin(angle1);
      const c2 = Math.cos(angle2);
      const s2 = Math.sin(angle2);

      // uv.x は角度（一周で 0→1）、uv.y は外周=1 / 内周=0。
      const u1 = i / numSubdivisions;
      const u2 = (i + 1) / numSubdivisions;

      // 外周は外向き (c, s)、内周は内向き (-c, -s) の法線
      // 最初の三角形
      addVertex(c1 * radius, s1 * radius, c1, s1, nz, u1, 1);
      addVertex(c2 * radius, s2 * radius, c2, s2, nz, u2, 1);
      addVertex(c1 * innerRadius, s1 * innerRadius, -c1, -s1, nz, u1, 0);

      // 2番目の三角形
      addVertex(c1 * innerRadius, s1 * innerRadius, -c1, -s1, nz, u1, 0);
      addVertex(c2 * radius, s2 * radius, c2, s2, nz, u2, 1);
      addVertex(c2 * innerRadius, s2 * innerRadius, -c2, -s2, nz, u2, 0);
    }

    return {
      vertexData,
      numVertices,
    };
  };
}
