import { mat4 } from 'wgpu-matrix';
import generateMips_wgsl from '../shaders/generateMips.wgsl';
import index_wgsl from '../shaders/index.wgsl';

type TextureSource = ImageBitmap | HTMLCanvasElement;

interface ObjectInfo {
  bindGroup: GPUBindGroup;
  matrix: Float32Array<ArrayBuffer>;
  uniformValues: Float32Array<ArrayBuffer>;
  uniformBuffer: GPUBuffer;
}

export class App {
  private static readonly canvasSize = 256;

  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly pipeline: GPURenderPipeline;
  private readonly objectInfos: ObjectInfo[];
  private readonly texture: GPUTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly colorAttachment: GPURenderPassColorAttachment;
  private readonly renderPassDescriptor: GPURenderPassDescriptor;
  private rafId?: number;
  private observer?: ResizeObserver;

  private static mipModule?: GPUShaderModule;
  private static mipSampler?: GPUSampler;
  private static readonly pipelineByFormat: Record<string, GPURenderPipeline> =
    {};

  private constructor(fields: {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    pipeline: GPURenderPipeline;
    objectInfos: ObjectInfo[];
    texture: GPUTexture;
    ctx: CanvasRenderingContext2D;
    colorAttachment: GPURenderPassColorAttachment;
    renderPassDescriptor: GPURenderPassDescriptor;
  }) {
    this.canvas = fields.canvas;
    this.device = fields.device;
    this.context = fields.context;
    this.pipeline = fields.pipeline;
    this.objectInfos = fields.objectInfos;
    this.texture = fields.texture;
    this.ctx = fields.ctx;
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

    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) {
      throw new Error('2D コンテキストを取得できませんでした。');
    }
    ctx.canvas.width = App.canvasSize;
    ctx.canvas.height = App.canvasSize;

    const texture = App.createTextureFromSource(device, ctx.canvas, {
      mips: true,
    });

    const matrixOffset = 0;

    const objectInfos: ObjectInfo[] = [];
    for (let i = 0; i < 8; ++i) {
      const sampler = device.createSampler({
        addressModeU: 'repeat',
        addressModeV: 'repeat',
        magFilter: i & 1 ? 'linear' : 'nearest',
        minFilter: i & 2 ? 'linear' : 'nearest',
        mipmapFilter: i & 4 ? 'linear' : 'nearest',
      });

      const uniformBufferSize = 16 * 4; // matrix is 16 32bit floats (4bytes each)
      const uniformBuffer = device.createBuffer({
        label: 'uniforms for quad',
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const uniformValues = new Float32Array(uniformBufferSize / 4);
      const matrix = uniformValues.subarray(matrixOffset, 16);

      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: texture },
          { binding: 2, resource: uniformBuffer },
        ],
      });

      objectInfos.push({ bindGroup, matrix, uniformValues, uniformBuffer });
    }

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
      objectInfos,
      texture,
      ctx,
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
    this.rafId = requestAnimationFrame(this.render);
  }

  dispose() {
    if (this.rafId !== undefined) {
      cancelAnimationFrame(this.rafId);
      this.rafId = undefined;
    }
    this.observer?.disconnect();
    this.observer = undefined;
  }

  private update2DCanvas(time: number) {
    const { ctx } = this;
    const size = App.canvasSize;
    const half = size / 2;

    time *= 0.0001;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(half, half);
    const num = 20;
    for (let i = 0; i < num; ++i) {
      ctx.fillStyle = App.hsl((i / num) * 0.2 + time * 0.1, 1, (i % 2) * 0.5);
      ctx.fillRect(-half, -half, size, size);
      ctx.rotate(time * 0.5);
      ctx.scale(0.85, 0.85);
      ctx.translate(size / 16, 0);
    }
    ctx.restore();
  }

  private render(time: number) {
    this.update2DCanvas(time);
    App.copySourceToTexture(this.device, this.texture, this.ctx.canvas);

    const fov = (60 * Math.PI) / 180;
    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    const zNear = 1;
    const zFar = 2000;
    const projectionMatrix = mat4.perspective(fov, aspect, zNear, zFar);

    const cameraPosition = [0, 0, 2];
    const up = [0, 1, 0];
    const target = [0, 0, 0];
    const viewMatrix = mat4.lookAt(cameraPosition, target, up);
    const viewProjectionMatrix = mat4.multiply(projectionMatrix, viewMatrix);

    const currentTexture = this.context.getCurrentTexture();
    this.colorAttachment.view = currentTexture.createView();

    const encoder = this.device.createCommandEncoder({
      label: 'render quad encoder',
    });
    const pass = encoder.beginRenderPass(this.renderPassDescriptor);
    pass.setPipeline(this.pipeline);

    this.objectInfos.forEach(
      ({ bindGroup, matrix, uniformBuffer, uniformValues }, i) => {
        const xSpacing = 1.2;
        const ySpacing = 0.7;
        const zDepth = 50;

        const x = (i % 4) - 1.5;
        const y = i < 4 ? 1 : -1;

        mat4.translate(
          viewProjectionMatrix,
          [x * xSpacing, y * ySpacing, -zDepth * 0.5],
          matrix,
        );
        mat4.rotateX(matrix, 0.5 * Math.PI, matrix);
        mat4.scale(matrix, [1, zDepth * 2, 1], matrix);
        mat4.translate(matrix, [-0.5, -0.5, 0], matrix);

        this.device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

        pass.setBindGroup(0, bindGroup);
        pass.draw(6);
      },
    );

    pass.end();

    const commandBuffer = encoder.finish();
    this.device.queue.submit([commandBuffer]);

    this.rafId = requestAnimationFrame(this.render);
  }

  private resize(entries: ResizeObserverEntry[]) {
    for (const entry of entries) {
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;

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

  private static hsl(h: number, s: number, l: number): string {
    return `hsl(${(h * 360) | 0}, ${s * 100}%, ${(l * 100) | 0}%)`;
  }

  private static numMipLevels(...sizes: number[]): number {
    const maxSize = Math.max(...sizes);
    return (1 + Math.log2(maxSize)) | 0;
  }

  private static copySourceToTexture(
    device: GPUDevice,
    texture: GPUTexture,
    source: TextureSource,
    { flipY }: { flipY?: boolean } = {},
  ) {
    device.queue.copyExternalImageToTexture(
      { source, flipY },
      { texture },
      { width: source.width, height: source.height },
    );

    if (texture.mipLevelCount > 1) {
      App.generateMips(device, texture);
    }
  }

  private static createTextureFromSource(
    device: GPUDevice,
    source: TextureSource,
    options: { mips?: boolean; flipY?: boolean } = {},
  ): GPUTexture {
    const texture = device.createTexture({
      label: 'texture from canvas',
      format: 'rgba8unorm',
      mipLevelCount: options.mips
        ? App.numMipLevels(source.width, source.height)
        : 1,
      size: [source.width, source.height],
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    App.copySourceToTexture(device, texture, source, options);
    return texture;
  }

  private static generateMips(device: GPUDevice, texture: GPUTexture) {
    if (!App.mipModule) {
      App.mipModule = device.createShaderModule({
        label: 'textured quad shaders for mip level generation',
        code: generateMips_wgsl,
      });

      App.mipSampler = device.createSampler({ minFilter: 'linear' });
    }

    if (!App.pipelineByFormat[texture.format]) {
      App.pipelineByFormat[texture.format] = device.createRenderPipeline({
        label: 'mip level generator pipeline',
        layout: 'auto',
        vertex: { module: App.mipModule },
        fragment: {
          module: App.mipModule,
          targets: [{ format: texture.format }],
        },
      });
    }
    const pipeline = App.pipelineByFormat[texture.format];

    const encoder = device.createCommandEncoder({ label: 'mip gen encoder' });

    for (
      let baseMipLevel = 1;
      baseMipLevel < texture.mipLevelCount;
      ++baseMipLevel
    ) {
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: App.mipSampler as GPUSampler },
          {
            binding: 1,
            resource: texture.createView({
              baseMipLevel: baseMipLevel - 1,
              mipLevelCount: 1,
            }),
          },
        ],
      });

      const renderPassDescriptor: GPURenderPassDescriptor = {
        label: 'mip gen renderPass',
        colorAttachments: [
          {
            view: texture.createView({ baseMipLevel, mipLevelCount: 1 }),
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      };

      const pass = encoder.beginRenderPass(renderPassDescriptor);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(6);
      pass.end();
    }

    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);
  }
}
