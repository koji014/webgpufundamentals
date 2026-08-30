import GUI from 'muigui';
import { mat3, mat3ToPadded } from '../../_lib/mat3';
import index_wgsl from '../shaders/index.wgsl';

interface Settings {
  translation: [number, number];
  rotation: number;
  scale: [number, number];
}

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniformBuffer: GPUBuffer;
  private readonly uniformValues: Float32Array<ArrayBuffer>;
  private readonly resolutionValue: Float32Array<ArrayBuffer>;
  private readonly matrixValue: Float32Array<ArrayBuffer>;
  private readonly vertexBuffer: GPUBuffer;
  private readonly indexBuffer: GPUBuffer;
  private readonly numVertices: number;
  private readonly bindGroup: GPUBindGroup;
  private readonly settings: Settings;
  private readonly colorAttachment: GPURenderPassColorAttachment;
  private readonly renderPassDescriptor: GPURenderPassDescriptor;
  private observer?: ResizeObserver;
  private gui?: GUI;

  private constructor(fields: {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    pipeline: GPURenderPipeline;
    uniformBuffer: GPUBuffer;
    uniformValues: Float32Array<ArrayBuffer>;
    resolutionValue: Float32Array<ArrayBuffer>;
    matrixValue: Float32Array<ArrayBuffer>;
    vertexBuffer: GPUBuffer;
    indexBuffer: GPUBuffer;
    numVertices: number;
    bindGroup: GPUBindGroup;
    settings: Settings;
    colorAttachment: GPURenderPassColorAttachment;
    renderPassDescriptor: GPURenderPassDescriptor;
  }) {
    this.canvas = fields.canvas;
    this.device = fields.device;
    this.context = fields.context;
    this.pipeline = fields.pipeline;
    this.uniformBuffer = fields.uniformBuffer;
    this.uniformValues = fields.uniformValues;
    this.resolutionValue = fields.resolutionValue;
    this.matrixValue = fields.matrixValue;
    this.vertexBuffer = fields.vertexBuffer;
    this.indexBuffer = fields.indexBuffer;
    this.numVertices = fields.numVertices;
    this.bindGroup = fields.bindGroup;
    this.settings = fields.settings;
    this.colorAttachment = fields.colorAttachment;
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
      label: 'just 2d position',
      layout: 'auto',
      vertex: {
        module: shaderModule,
        buffers: [
          {
            arrayStride: 2 * 4, // 2 floats, 4 bytes each
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' }, // position
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        targets: [{ format: presentationFormat }],
      },
    });

    // color, resolution, padding, matrix
    const uniformBufferSize = (4 + 2 + 2 + 12) * 4;
    const uniformBuffer = device.createBuffer({
      label: 'uniforms',
      size: uniformBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const uniformValues = new Float32Array(uniformBufferSize / 4);

    const kColorOffset = 0;
    const kResolutionOffset = 4;
    const kMatrixOffset = 8;

    const colorValue = uniformValues.subarray(kColorOffset, kColorOffset + 4);
    const resolutionValue = uniformValues.subarray(
      kResolutionOffset,
      kResolutionOffset + 2,
    );
    const matrixValue = uniformValues.subarray(
      kMatrixOffset,
      kMatrixOffset + 12,
    );

    colorValue.set([Math.random(), Math.random(), Math.random(), 1]);

    const { vertexData, indexData, numVertices } = App.createFVertices();
    const vertexBuffer = device.createBuffer({
      label: 'vertex buffer vertices',
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, vertexData);

    const indexBuffer = device.createBuffer({
      label: 'index buffer',
      size: indexData.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(indexBuffer, 0, indexData);

    const bindGroup = device.createBindGroup({
      label: 'bind group for object',
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: uniformBuffer }],
    });

    const colorAttachment: GPURenderPassColorAttachment = {
      view: undefined as unknown as GPUTextureView,
      loadOp: 'clear',
      storeOp: 'store',
    };

    const renderPassDescriptor: GPURenderPassDescriptor = {
      label: 'our basic canvas renderPass',
      colorAttachments: [colorAttachment],
    };

    const settings: Settings = {
      translation: [150, 100],
      rotation: App.degToRad(30),
      scale: [1, 1],
    };

    const app = new App({
      canvas,
      device,
      context,
      pipeline,
      uniformBuffer,
      uniformValues,
      resolutionValue,
      matrixValue,
      vertexBuffer,
      indexBuffer,
      numVertices,
      bindGroup,
      settings,
      colorAttachment,
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
    gui.add(settings.translation, '0', 0, 1000).name('translation.x');
    gui.add(settings.translation, '1', 0, 1000).name('translation.y');
    gui.add(settings, 'rotation', radToDegOptions);
    gui.add(settings.scale, '0', -5, 5).name('scale.x');
    gui.add(settings.scale, '1', -5, 5).name('scale.y');
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
  }

  private render() {
    const currentTexture = this.context.getCurrentTexture();
    this.colorAttachment.view = currentTexture.createView();

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass(this.renderPassDescriptor);
    pass.setPipeline(this.pipeline);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setIndexBuffer(this.indexBuffer, 'uint32');

    const translationMatrix = mat3.translation(this.settings.translation);
    const rotationMatrix = mat3.rotation(this.settings.rotation);
    const scaleMatrix = mat3.scaling(this.settings.scale);

    let matrix = mat3.multiply(translationMatrix, rotationMatrix);
    matrix = mat3.multiply(matrix, scaleMatrix);

    this.resolutionValue.set([this.canvas.width, this.canvas.height]);
    this.matrixValue.set(mat3ToPadded(matrix));

    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformValues);

    pass.setBindGroup(0, this.bindGroup);
    pass.drawIndexed(this.numVertices);

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
    const vertexData = new Float32Array([
      // left column
        0,   0,
       30,   0,
        0, 150,
       30, 150,

      // top rung
       30,   0,
      100,   0,
       30,  30,
      100,  30,

      // middle rung
       30,  60,
       70,  60,
       30,  90,
       70,  90,
    ]);

    // biome-ignore format: _
    const indexData = new Uint32Array([
       0,  1,  2,    2,  1,  3,  // left column
       4,  5,  6,    6,  5,  7,  // top rung
       8,  9, 10,   10,  9, 11,  // middle rung
    ]);

    return {
      vertexData,
      indexData,
      numVertices: indexData.length,
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
