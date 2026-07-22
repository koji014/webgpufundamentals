import GUI from 'muigui';
import index_wgsl from '../shaders/index.wgsl';

interface UniformOffsets {
  scale: number;
  offset: number;
}

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly pipeline: GPURenderPipeline;
  private readonly bindGroups: GPUBindGroup[];
  private readonly uniformOffsets: UniformOffsets;
  private readonly uniformBuffer: GPUBuffer;
  private readonly uniformValues: Float32Array<ArrayBuffer>;
  private readonly settings: GPUSamplerDescriptor;
  private readonly colorAttachment: GPURenderPassColorAttachment;
  private readonly renderPassDescriptor: GPURenderPassDescriptor;
  private observer?: ResizeObserver;
  private gui?: GUI;

  private constructor(fields: {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    pipeline: GPURenderPipeline;
    bindGroups: GPUBindGroup[];
    uniformOffsets: UniformOffsets;
    uniformBuffer: GPUBuffer;
    uniformValues: Float32Array<ArrayBuffer>;
    settings: GPUSamplerDescriptor;
    colorAttachment: GPURenderPassColorAttachment;
    renderPassDescriptor: GPURenderPassDescriptor;
  }) {
    this.canvas = fields.canvas;
    this.device = fields.device;
    this.context = fields.context;
    this.pipeline = fields.pipeline;
    this.bindGroups = fields.bindGroups;
    this.uniformOffsets = fields.uniformOffsets;
    this.uniformBuffer = fields.uniformBuffer;
    this.uniformValues = fields.uniformValues;
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
    context.configure({ device, format: presentationFormat });

    const shaderModule = device.createShaderModule({
      label: 'shaderModule label',
      code: index_wgsl,
    });

    const pipeline = device.createRenderPipeline({
      label: 'pipeline label',
      layout: 'auto',
      vertex: {
        module: shaderModule,
      },
      fragment: {
        module: shaderModule,
        targets: [{ format: presentationFormat }],
      },
    });

    const textureWidth = 5;
    const textureHeight = 7;

    const _ = [255, 0, 0, 255]; // red
    const y = [255, 255, 0, 255]; // yellow
    const b = [0, 0, 255, 255]; // blue
    // biome-ignore format: _
    const textureData = new Uint8Array([
      _, _, _, _, _,
      _, y, _, _, _,
      _, y, _, _, _,
      _, y, y, _, _,
      _, y, _, _, _,
      _, y, y, y, _,
      b, _, _, _, _,
    ].flat());

    const texture = device.createTexture({
      label: 'yellow F on red',
      size: [textureWidth, textureHeight],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture },
      textureData,
      { bytesPerRow: textureWidth * 4 },
      { width: textureWidth, height: textureHeight },
    );

    const uniformBufferSize =
      2 * 4 + // scale is 2 32bit floats (4bytes each)
      2 * 4; // offset is 2 32bit floats (4bytes each)

    const uniformBuffer = device.createBuffer({
      label: 'uniforms for quad',
      size: uniformBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const uniformValues = new Float32Array(uniformBufferSize / 4);

    const uniformOffsets = {
      scale: 0,
      offset: 2,
    };

    const bindGroups = [];

    for (let i = 0; i < 16; ++i) {
      const sampler = device.createSampler({
        addressModeU: i & 1 ? 'repeat' : 'clamp-to-edge',
        addressModeV: i & 2 ? 'repeat' : 'clamp-to-edge',
        magFilter: i & 4 ? 'linear' : 'nearest',
        minFilter: i & 8 ? 'linear' : 'nearest',
      });

      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: texture },
          { binding: 2, resource: uniformBuffer },
        ],
      });

      bindGroups.push(bindGroup);
    }

    const settings: GPUSamplerDescriptor = {
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      magFilter: 'linear',
      minFilter: 'linear',
    };

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
      bindGroups,
      uniformOffsets,
      uniformBuffer,
      uniformValues,
      settings,
      colorAttachment,
      renderPassDescriptor,
    });

    const addressOptions = ['repeat', 'clamp-to-edge'];
    const filterOptions = ['nearest', 'linear'];

    const gui = new GUI();
    Object.assign(gui.domElement.style, {
      top: '50px',
      right: '',
      left: '8px',
    });
    gui.add(settings, 'addressModeU', addressOptions);
    gui.add(settings, 'addressModeV', addressOptions);
    gui.add(settings, 'magFilter', filterOptions);
    gui.add(settings, 'minFilter', filterOptions);
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
    requestAnimationFrame(this.render);
  }

  dispose() {
    this.observer?.disconnect();
    this.observer = undefined;
    this.gui?.domElement.remove();
    this.gui = undefined;
  }

  private render(time: number) {
    time *= 0.001;

    const ndx =
      (this.settings.addressModeU === 'repeat' ? 1 : 0) +
      (this.settings.addressModeV === 'repeat' ? 2 : 0) +
      (this.settings.magFilter === 'linear' ? 4 : 0) +
      (this.settings.minFilter === 'linear' ? 8 : 0);
    const bindGroup = this.bindGroups[ndx];

    // 0 から 1 のクリップ空間クワッドを描画するスケールを計算
    // キャンバスの 2x2 ピクセル
    const scaleX = 4 / this.canvas.width;
    const scaleY = 4 / this.canvas.height;

    this.uniformValues.set([scaleX, scaleY], this.uniformOffsets.scale);
    this.uniformValues.set(
      [Math.sin(time * 0.5) * 0.8, -0.8],
      this.uniformOffsets.offset,
    );

    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformValues);

    const currentTexture = this.context.getCurrentTexture();
    this.colorAttachment.view = currentTexture.createView();

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass(this.renderPassDescriptor);
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);

    pass.draw(6);
    pass.end();

    const commandBuffer = encoder.finish();
    this.device.queue.submit([commandBuffer]);

    requestAnimationFrame(this.render);
  }

  private resize(entries: ResizeObserverEntry[]) {
    for (const entry of entries) {
      const width = (entry.contentBoxSize[0].inlineSize / 128) | 0;
      const height = (entry.contentBoxSize[0].blockSize / 128) | 0;

      const maxSize = this.device.limits.maxTextureDimension2D;
      this.canvas.width = Math.max(1, Math.min(width, maxSize));
      this.canvas.height = Math.max(1, Math.min(height, maxSize));
    }
  }

  private static async getDevice(): Promise<GPUDevice> {
    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) {
      throw new Error('WebGPU対応ブラウザが必要です');
    }

    return device;
  }
}
