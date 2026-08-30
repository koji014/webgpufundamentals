import GUI from 'muigui';
import { mat4 } from '../../_lib/mat4';
import index_wgsl from '../shaders/index.wgsl';

interface Settings {
  fieldOfView: number;
  cameraAngle: number;
}

interface ObjectInfo {
  uniformBuffer: GPUBuffer;
  uniformValues: Float32Array<ArrayBuffer>;
  matrixValue: Float32Array<ArrayBuffer>;
  bindGroup: GPUBindGroup;
}

export class App {
  private static readonly radius = 200;
  private static readonly numFs = 5;

  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly pipeline: GPURenderPipeline;
  private readonly vertexBuffer: GPUBuffer;
  private readonly numVertices: number;
  private readonly objectInfos: ObjectInfo[];
  private readonly settings: Settings;
  private readonly colorAttachment: GPURenderPassColorAttachment;
  private readonly depthStencilAttachment: GPURenderPassDepthStencilAttachment;
  private readonly renderPassDescriptor: GPURenderPassDescriptor;
  private depthTexture?: GPUTexture;
  private observer?: ResizeObserver;
  private gui?: GUI;

  private constructor(fields: {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    pipeline: GPURenderPipeline;
    vertexBuffer: GPUBuffer;
    numVertices: number;
    objectInfos: ObjectInfo[];
    settings: Settings;
    colorAttachment: GPURenderPassColorAttachment;
    depthStencilAttachment: GPURenderPassDepthStencilAttachment;
    renderPassDescriptor: GPURenderPassDescriptor;
  }) {
    this.canvas = fields.canvas;
    this.device = fields.device;
    this.context = fields.context;
    this.pipeline = fields.pipeline;
    this.vertexBuffer = fields.vertexBuffer;
    this.numVertices = fields.numVertices;
    this.objectInfos = fields.objectInfos;
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

    const shaderModule = device.createShaderModule({
      code: index_wgsl,
    });

    const pipeline = device.createRenderPipeline({
      label: '2 attributes',
      layout: 'auto',
      vertex: {
        module: shaderModule,
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
        module: shaderModule,
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

    const { vertexData, numVertices } = App.createFVertices();
    const vertexBuffer = device.createBuffer({
      label: 'vertex buffer vertices',
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, vertexData);

    // F ごとに行列 uniform とバインドグループを用意する
    const objectInfos: ObjectInfo[] = [];
    for (let i = 0; i < App.numFs; ++i) {
      const uniformBufferSize = 16 * 4; // matrix
      const uniformBuffer = device.createBuffer({
        label: 'uniforms',
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const uniformValues = new Float32Array(uniformBufferSize / 4);
      const matrixValue = uniformValues.subarray(0, 16);

      const bindGroup = device.createBindGroup({
        label: 'bind group for object',
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: uniformBuffer }],
      });

      objectInfos.push({
        uniformBuffer,
        uniformValues,
        matrixValue,
        bindGroup,
      });
    }

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
      fieldOfView: App.degToRad(100),
      cameraAngle: 0,
    };

    const app = new App({
      canvas,
      device,
      context,
      pipeline,
      vertexBuffer,
      numVertices,
      objectInfos,
      settings,
      colorAttachment,
      depthStencilAttachment,
      renderPassDescriptor,
    });

    const radToDegOptions = {
      min: -360,
      max: 360,
      step: 1,
      converters: GUI.converters.radToDeg,
    };

    const gui = new GUI();
    gui.onChange(app.render);
    gui.add(settings, 'fieldOfView', {
      min: 1,
      max: 179,
      converters: GUI.converters.radToDeg,
    });
    gui.add(settings, 'cameraAngle', radToDegOptions);
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
    pass.setVertexBuffer(0, this.vertexBuffer);

    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    const projection = mat4.perspective(
      this.settings.fieldOfView,
      aspect,
      1, // zNear
      2000, // zFar
    );

    // 最初の F の位置
    const fPosition = [App.radius, 0, 0];

    const tempMatrix = mat4.rotationY(this.settings.cameraAngle);
    mat4.translate(tempMatrix, [0, 0, App.radius * 1.5], tempMatrix);

    // 計算した行列からカメラの位置を取り出す
    const eye = tempMatrix.slice(12, 15);

    const up = [0, 1, 0];

    // cameraAim でカメラ行列を作る
    const cameraMatrix = mat4.cameraAim(eye, fPosition, up);

    // カメラ行列の逆行列がビュー行列
    const viewMatrix = mat4.inverse(cameraMatrix);

    // ビュー行列と射影行列を合成
    const viewProjectionMatrix = mat4.multiply(projection, viewMatrix);

    this.objectInfos.forEach(
      ({ matrixValue, uniformBuffer, uniformValues, bindGroup }, i) => {
        const angle = (i / App.numFs) * Math.PI * 2;
        const x = Math.cos(angle) * App.radius;
        const z = Math.sin(angle) * App.radius;

        mat4.translate(viewProjectionMatrix, [x, 0, z], matrixValue);

        this.device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

        pass.setBindGroup(0, bindGroup);
        pass.draw(this.numVertices);
      },
    );

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

  private static createFVertices() {
    // biome-ignore format: _
    const positions = [
      // left column
      -50,  75,  15,
      -20,  75,  15,
      -50, -75,  15,
      -20, -75,  15,

      // top rung
      -20,  75,  15,
       50,  75,  15,
      -20,  45,  15,
       50,  45,  15,

      // middle rung
      -20,  15,  15,
       20,  15,  15,
      -20, -15,  15,
       20, -15,  15,

      // left column back
      -50,  75, -15,
      -20,  75, -15,
      -50, -75, -15,
      -20, -75, -15,

      // top rung back
      -20,  75, -15,
       50,  75, -15,
      -20,  45, -15,
       50,  45, -15,

      // middle rung back
      -20,  15, -15,
       20,  15, -15,
      -20, -15, -15,
       20, -15, -15,
    ];

    // biome-ignore format: _
    const indices = [
       0,  2,  1,    2,  3,  1,  // left column
       4,  6,  5,    6,  7,  5,  // top run
       8, 10,  9,   10, 11,  9,  // middle run

      12, 13, 14,   14, 13, 15,  // left column back
      16, 17, 18,   18, 17, 19,  // top run back
      20, 21, 22,   22, 21, 23,  // middle run back

       0,  5, 12,   12,  5, 17,  // top
       5,  7, 17,   17,  7, 19,  // top rung right
       6, 18,  7,   18, 19,  7,  // top rung bottom
       6,  8, 18,   18,  8, 20,  // between top and middle rung
       8,  9, 20,   20,  9, 21,  // middle rung top
       9, 11, 21,   21, 11, 23,  // middle rung right
      10, 22, 11,   22, 23, 11,  // middle rung bottom
      10,  3, 22,   22,  3, 15,  // stem right
       2, 14,  3,   14, 15,  3,  // bottom
       0, 12,  2,   12, 14,  2,  // left
    ];

    // biome-ignore format: _
    const quadColors = [
      200,  70, 120,  // left column front
      200,  70, 120,  // top rung front
      200,  70, 120,  // middle rung front

       80,  70, 200,  // left column back
       80,  70, 200,  // top rung back
       80,  70, 200,  // middle rung back

       70, 200, 210,  // top
      160, 160, 220,  // top rung right
       90, 130, 110,  // top rung bottom
      200, 200,  70,  // between top and middle rung
      210, 100,  70,  // middle rung top
      210, 160,  70,  // middle rung right
       70, 180, 210,  // middle rung bottom
      100,  70, 210,  // stem right
       76, 210, 100,  // bottom
      140, 210,  80,  // left
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

    return {
      vertexData,
      numVertices,
    };
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
