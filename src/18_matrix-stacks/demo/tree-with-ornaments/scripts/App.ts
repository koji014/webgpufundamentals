import GUI from 'muigui';
import { MatrixStack } from '../../_lib/MatrixStack';
import { mat4 } from '../../_lib/mat4';
import { vec3 } from '../../_lib/vec3';
import index_wgsl from '../shaders/index.wgsl';

interface Settings {
  baseRotation: number;
  scale: number;
  rotationX: number;
  rotationY: number;
}

interface Vertices {
  vertexBuffer: GPUBuffer;
  numVertices: number;
}

interface ObjectInfo {
  uniformBuffer: GPUBuffer;
  uniformValues: Float32Array<ArrayBuffer>;
  matrixValue: Float32Array<ArrayBuffer>;
  colorValue: Float32Array<ArrayBuffer>;
  bindGroup: GPUBindGroup;
}

interface DrawContext {
  pass: GPURenderPassEncoder;
  stack: MatrixStack;
  viewProjectionMatrix: Float32Array;
}

export class App {
  private static readonly kTreeDepth = 6;
  private static readonly kHeight = 1;

  private static readonly kBranchPosition = [-0.5, 0, 0.5];
  private static readonly kBranchSize = [20, 150, 20];
  private static readonly kWhite = [1, 1, 1, 1];

  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly pipeline: GPURenderPipeline;
  private readonly cubeVertices: Vertices;
  private readonly ornamentVertices: Vertices;
  private readonly objectInfos: ObjectInfo[];
  private readonly stack: MatrixStack;
  private readonly settings: Settings;
  private readonly colorAttachment: GPURenderPassColorAttachment;
  private readonly depthStencilAttachment: GPURenderPassDepthStencilAttachment;
  private readonly renderPassDescriptor: GPURenderPassDescriptor;
  private objectNdx = 0;
  private depthTexture?: GPUTexture;
  private observer?: ResizeObserver;
  private gui?: GUI;

  private constructor(fields: {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    pipeline: GPURenderPipeline;
    cubeVertices: Vertices;
    ornamentVertices: Vertices;
    settings: Settings;
    colorAttachment: GPURenderPassColorAttachment;
    depthStencilAttachment: GPURenderPassDepthStencilAttachment;
    renderPassDescriptor: GPURenderPassDescriptor;
  }) {
    this.canvas = fields.canvas;
    this.device = fields.device;
    this.context = fields.context;
    this.pipeline = fields.pipeline;
    this.cubeVertices = fields.cubeVertices;
    this.ornamentVertices = fields.ornamentVertices;
    this.objectInfos = [];
    this.stack = new MatrixStack();
    this.settings = fields.settings;
    this.colorAttachment = fields.colorAttachment;
    this.depthStencilAttachment = fields.depthStencilAttachment;
    this.renderPassDescriptor = fields.renderPassDescriptor;

    this.render = this.render.bind(this);
  }

  static async create(canvas: HTMLCanvasElement): Promise<App> {
    const device = await App.getDevice();

    const context = canvas.getContext('webgpu');
    if (!context) {
      throw new Error('webgpu コンテキストを取得できませんでした。');
    }

    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format: presentationFormat,
      alphaMode: 'premultiplied',
    });

    const module = device.createShaderModule({
      code: index_wgsl,
    });

    const pipeline = device.createRenderPipeline({
      label: '2 attributes with color',
      layout: 'auto',
      vertex: {
        module,
        buffers: [
          {
            arrayStride: 4 * 4, // (3) float + (1) color(unorm8x4) = 16 bytes
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' }, // position
              { shaderLocation: 1, offset: 12, format: 'unorm8x4' }, // color
            ],
          },
        ],
      },
      fragment: {
        module,
        targets: [{ format: presentationFormat }],
      },
      primitive: {
        cullMode: 'back',
      },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus',
      },
    });

    const cubeVertices = App.createVertices(
      device,
      App.createCubeVertices(),
      'cube',
    );
    const ornamentVertices = App.createVertices(
      device,
      App.createConeVertices({ radius: 20, height: 60 }),
      'ornament',
    );

    const colorAttachment: GPURenderPassColorAttachment = {
      view: undefined as unknown as GPUTextureView,
      loadOp: 'clear',
      storeOp: 'store',
    };

    const depthStencilAttachment: GPURenderPassDepthStencilAttachment = {
      view: undefined as unknown as GPUTextureView,
      depthClearValue: 1.0,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    };

    const renderPassDescriptor: GPURenderPassDescriptor = {
      label: 'our basic canvas renderPass',
      colorAttachments: [colorAttachment],
      depthStencilAttachment,
    };

    const settings: Settings = {
      baseRotation: 0,
      scale: 0.9,
      rotationX: App.degToRad(20),
      rotationY: App.degToRad(10),
    };

    const app = new App({
      canvas,
      device,
      context,
      pipeline,
      cubeVertices,
      ornamentVertices,
      settings,
      colorAttachment,
      depthStencilAttachment,
      renderPassDescriptor,
    });

    const radToDegOptions = {
      min: -180,
      max: 180,
      step: 1,
      converters: GUI.converters.radToDeg,
    };
    const treeRadToDegOptions = {
      min: 0,
      max: 90,
      step: 1,
      converters: GUI.converters.radToDeg,
    };

    const gui = new GUI();
    gui.onChange(app.render);
    gui.add(settings, 'scale', 0.1, 1.2);
    gui.add(settings, 'rotationX', treeRadToDegOptions);
    gui.add(settings, 'rotationY', treeRadToDegOptions);
    gui.add(settings, 'baseRotation', radToDegOptions);
    app.gui = gui;

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
    this.gui?.domElement.remove();
    this.gui = undefined;
    this.depthTexture?.destroy();
    this.depthTexture = undefined;
  }

  private createObjectInfo(): ObjectInfo {
    const uniformBufferSize = (16 + 4) * 4; // matrix + color
    const uniformBuffer = this.device.createBuffer({
      label: 'uniforms',
      size: uniformBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const uniformValues = new Float32Array(uniformBufferSize / 4);

    const kMatrixOffset = 0;
    const kColorOffset = 16;
    const matrixValue = uniformValues.subarray(
      kMatrixOffset,
      kMatrixOffset + 16,
    );
    const colorValue = uniformValues.subarray(kColorOffset, kColorOffset + 4);

    const bindGroup = this.device.createBindGroup({
      label: 'bind group for object',
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: uniformBuffer }],
    });

    return { uniformBuffer, uniformValues, matrixValue, colorValue, bindGroup };
  }

  private drawObject(
    ctx: DrawContext,
    vertices: Vertices,
    matrix: Float32Array,
    color: number[],
  ) {
    const { pass, viewProjectionMatrix } = ctx;
    const { vertexBuffer, numVertices } = vertices;
    if (this.objectNdx === this.objectInfos.length) {
      this.objectInfos.push(this.createObjectInfo());
    }
    const { matrixValue, colorValue, uniformBuffer, uniformValues, bindGroup } =
      this.objectInfos[this.objectNdx++];

    mat4.multiply(viewProjectionMatrix, matrix, matrixValue);
    colorValue.set(color);

    this.device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

    pass.setVertexBuffer(0, vertexBuffer);
    pass.setBindGroup(0, bindGroup);
    pass.draw(numVertices);
  }

  private drawBranch(ctx: DrawContext) {
    const { stack } = ctx;
    stack.save().scale(App.kBranchSize).translate(App.kBranchPosition);
    this.drawObject(ctx, this.cubeVertices, stack.get(), App.kWhite);
    stack.restore();
  }

  private drawTreeLevel(ctx: DrawContext, offset: number, treeDepth: number) {
    const { stack } = ctx;
    const s = offset ? this.settings.scale : 1;
    const y = offset ? App.kBranchSize[App.kHeight] : 0;
    stack
      .save()
      .translate([0, y, 0])
      .rotateZ(offset * this.settings.rotationX)
      .rotateY(Math.abs(offset) * this.settings.rotationY)
      .scale([s, s, s]);

    this.drawBranch(ctx);

    if (treeDepth > 0) {
      this.drawTreeLevel(ctx, -1, treeDepth - 1);
      this.drawTreeLevel(ctx, +1, treeDepth - 1);
    }

    if (treeDepth === 0 && offset > 0) {
      const position = vec3.getTranslation(stack.get());
      this.drawObject(
        ctx,
        this.ornamentVertices,
        mat4.translation([...position]),
        App.kWhite,
      );
    }

    stack.restore();
  }

  private render() {
    const canvasTexture = this.context.getCurrentTexture();
    this.colorAttachment.view = canvasTexture.createView();

    if (
      !this.depthTexture ||
      this.depthTexture.width !== canvasTexture.width ||
      this.depthTexture.height !== canvasTexture.height
    ) {
      this.depthTexture?.destroy();
      this.depthTexture = this.device.createTexture({
        size: [canvasTexture.width, canvasTexture.height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    this.depthStencilAttachment.view = this.depthTexture.createView();

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass(this.renderPassDescriptor);
    pass.setPipeline(this.pipeline);

    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    const projection = mat4.perspective(
      App.degToRad(60), // fieldOfView
      aspect,
      1, // zNear
      2000, // zFar
    );

    const eye = [0, 450, 1000];
    const target = [0, 450, 0];
    const up = [0, 1, 0];

    const viewMatrix = mat4.lookAt(eye, target, up);
    const viewProjectionMatrix = mat4.multiply(projection, viewMatrix);

    this.stack.save();
    this.stack.rotateY(this.settings.baseRotation);
    this.objectNdx = 0;
    const ctx: DrawContext = { pass, stack: this.stack, viewProjectionMatrix };
    this.drawTreeLevel(ctx, 0, App.kTreeDepth);
    this.stack.restore();

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

  private static createVertices(
    device: GPUDevice,
    {
      vertexData,
      numVertices,
    }: { vertexData: Float32Array<ArrayBuffer>; numVertices: number },
    name: string,
  ): Vertices {
    const vertexBuffer = device.createBuffer({
      label: `${name}: vertex buffer vertices`,
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, vertexData);
    return { vertexBuffer, numVertices };
  }

  private static createCubeVertices() {
    // biome-ignore format: _
    const positions = [
      // left
      0, 0,  0,
      0, 0, -1,
      0, 1,  0,
      0, 1, -1,

      // right
      1, 0,  0,
      1, 0, -1,
      1, 1,  0,
      1, 1, -1,
    ];

    // biome-ignore format: _
    const indices = [
       0,  2,  1,    2,  3,  1,   // left
       4,  5,  6,    6,  5,  7,   // right
       0,  4,  2,    2,  4,  6,   // front
       1,  3,  5,    5,  3,  7,   // back
       0,  1,  4,    4,  1,  5,   // bottom
       2,  6,  3,    3,  6,  7,   // top
    ];

    // biome-ignore format: _
    const quadColors = [
      200,  70, 120,  // left
       80,  70, 200,  // right
       70, 200, 210,  // front
      160, 160, 220,  // back
       90, 130, 110,  // bottom
      200, 200,  70,  // top
    ];

    const numVertices = indices.length;
    const vertexData = new Float32Array(numVertices * 4); // xyz + color
    const colorData = new Uint8Array(vertexData.buffer);

    for (let i = 0; i < indices.length; ++i) {
      const positionNdx = indices[i] * 3;
      const position = positions.slice(positionNdx, positionNdx + 3);
      vertexData.set(position, i * 4);

      const quadNdx = ((i / 6) | 0) * 3;
      const color = quadColors.slice(quadNdx, quadNdx + 3);
      colorData.set(color, i * 16 + 12);
      colorData[i * 16 + 15] = 255;
    }

    return { vertexData, numVertices };
  }

  private static createConeVertices({
    radius = 1,
    height = 1,
    subdivisions = 6,
  }: {
    radius?: number;
    height?: number;
    subdivisions?: number;
  } = {}) {
    const positions: number[] = [];
    const colors: number[] = [];

    const addVertex = (
      angle: number,
      radius: number,
      height: number,
      color: number[],
    ) => {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      positions.push(c * radius, height, s * radius);
      colors.push(...color);
    };

    for (let i = 0; i < subdivisions; ++i) {
      const angle0 = ((i + 0) / subdivisions) * Math.PI * 2;
      const angle1 = ((i + 1) / subdivisions) * Math.PI * 2;

      const u = (i + 1) / subdivisions;
      const color = [u * 128 + 127, 0, 0];

      // 側面
      addVertex(angle0, 0, 0, color);
      addVertex(angle1, radius, -height, color);
      addVertex(angle0, radius, -height, color);

      // 底面
      addVertex(angle0, radius, -height, color);
      addVertex(angle1, radius, -height, color);
      addVertex(angle0, 0, -height, color);
    }

    const numVertices = positions.length / 3;
    const vertexData = new Float32Array(numVertices * 4); // xyz + color
    const colorData = new Uint8Array(vertexData.buffer);

    for (let i = 0; i < numVertices; ++i) {
      const position = positions.slice(i * 3, i * 3 + 3);
      vertexData.set(position, i * 4);

      const color = colors.slice(i * 3, i * 3 + 3);
      colorData.set(color, i * 16 + 12);
      colorData[i * 16 + 15] = 255;
    }

    return { vertexData, numVertices };
  }

  private static async getDevice(): Promise<GPUDevice> {
    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) {
      throw new Error('WebGPU対応ブラウザが必要です');
    }

    return device;
  }

  private static degToRad(d: number): number {
    return (d * Math.PI) / 180;
  }
}
