import { mat4 } from 'wgpu-matrix';
import index_wgsl from '../shaders/index.wgsl';

interface Mip {
  data: Uint8Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

interface ObjectInfo {
  bindGroups: GPUBindGroup[];
  matrix: Float32Array<ArrayBuffer>;
  uniformValues: Float32Array<ArrayBuffer>;
  uniformBuffer: GPUBuffer;
}

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly pipeline: GPURenderPipeline;
  private readonly objectInfos: ObjectInfo[];
  private readonly textureCount: number;
  private readonly colorAttachment: GPURenderPassColorAttachment;
  private readonly renderPassDescriptor: GPURenderPassDescriptor;
  private texNdx = 0;
  private observer?: ResizeObserver;

  private constructor(fields: {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    pipeline: GPURenderPipeline;
    objectInfos: ObjectInfo[];
    textureCount: number;
    colorAttachment: GPURenderPassColorAttachment;
    renderPassDescriptor: GPURenderPassDescriptor;
  }) {
    this.canvas = fields.canvas;
    this.device = fields.device;
    this.context = fields.context;
    this.pipeline = fields.pipeline;
    this.objectInfos = fields.objectInfos;
    this.textureCount = fields.textureCount;
    this.colorAttachment = fields.colorAttachment;
    this.renderPassDescriptor = fields.renderPassDescriptor;

    this.render = this.render.bind(this);
    this.switchTexture = this.switchTexture.bind(this);
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

    const textures = [
      App.createTextureWithMips(device, App.createBlendedMipmap(), 'blended'),
      App.createTextureWithMips(device, App.createCheckedMipmap(), 'checker'),
    ];

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

      const bindGroups = textures.map((texture) =>
        device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: sampler },
            { binding: 1, resource: texture },
            { binding: 2, resource: uniformBuffer },
          ],
        }),
      );

      objectInfos.push({ bindGroups, matrix, uniformValues, uniformBuffer });
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
      textureCount: textures.length,
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
    this.canvas.addEventListener('click', this.switchTexture);
  }

  dispose() {
    this.observer?.disconnect();
    this.observer = undefined;
    this.canvas.removeEventListener('click', this.switchTexture);
  }

  private switchTexture() {
    this.texNdx = (this.texNdx + 1) % this.textureCount;
    this.render();
  }

  private render() {
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
      ({ bindGroups, matrix, uniformBuffer, uniformValues }, i) => {
        const bindGroup = bindGroups[this.texNdx];

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

  private static createTextureWithMips(
    device: GPUDevice,
    mips: Mip[],
    label: string,
  ): GPUTexture {
    const texture = device.createTexture({
      label,
      size: [mips[0].width, mips[0].height],
      mipLevelCount: mips.length,
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    mips.forEach(({ data, width, height }, mipLevel) => {
      device.queue.writeTexture(
        { texture, mipLevel },
        data,
        { bytesPerRow: width * 4 },
        { width, height },
      );
    });
    return texture;
  }

  private static lerp = (a: number, b: number, t: number): number =>
    a + (b - a) * t;

  private static mix = (a: Uint8Array, b: Uint8Array, t: number): Uint8Array =>
    a.map((v, i) => App.lerp(v, b[i], t));

  private static bilinearFilter(
    tl: Uint8Array,
    tr: Uint8Array,
    bl: Uint8Array,
    br: Uint8Array,
    t1: number,
    t2: number,
  ): Uint8Array {
    const t = App.mix(tl, tr, t1);
    const b = App.mix(bl, br, t1);
    return App.mix(t, b, t2);
  }

  private static createNextMipLevelRgba8Unorm({
    data: src,
    width: srcWidth,
    height: srcHeight,
  }: Mip): Mip {
    // compute the size of the next mip
    const dstWidth = Math.max(1, (srcWidth / 2) | 0);
    const dstHeight = Math.max(1, (srcHeight / 2) | 0);
    const dst = new Uint8Array(dstWidth * dstHeight * 4);

    const getSrcPixel = (x: number, y: number): Uint8Array => {
      const offset = (y * srcWidth + x) * 4;
      return src.subarray(offset, offset + 4) as Uint8Array;
    };

    for (let y = 0; y < dstHeight; ++y) {
      for (let x = 0; x < dstWidth; ++x) {
        // compute texcoord of the center of the destination texel
        const u = (x + 0.5) / dstWidth;
        const v = (y + 0.5) / dstHeight;

        // compute the same texcoord in the source - 0.5 a pixel
        const au = u * srcWidth - 0.5;
        const av = v * srcHeight - 0.5;

        // compute the src top left texel coord (not texcoord)
        const tx = au | 0;
        const ty = av | 0;

        // compute the mix amounts between pixels
        const t1 = au % 1;
        const t2 = av % 1;

        // get the 4 pixels
        const tl = getSrcPixel(tx, ty);
        const tr = getSrcPixel(tx + 1, ty);
        const bl = getSrcPixel(tx, ty + 1);
        const br = getSrcPixel(tx + 1, ty + 1);

        // copy the "sampled" result into the dest.
        const dstOffset = (y * dstWidth + x) * 4;
        dst.set(App.bilinearFilter(tl, tr, bl, br, t1, t2), dstOffset);
      }
    }
    return { data: dst, width: dstWidth, height: dstHeight };
  }

  private static generateMips = (
    src: Uint8Array<ArrayBuffer>,
    srcWidth: number,
  ): Mip[] => {
    const srcHeight = src.length / 4 / srcWidth;

    // populate with first mip level (base level)
    let mip: Mip = { data: src, width: srcWidth, height: srcHeight };
    const mips = [mip];

    while (mip.width > 1 || mip.height > 1) {
      mip = App.createNextMipLevelRgba8Unorm(mip);
      mips.push(mip);
    }
    return mips;
  };

  private static createBlendedMipmap(): Mip[] {
    const w = [255, 255, 255, 255];
    const r = [255, 0, 0, 255];
    const b = [0, 28, 116, 255];
    const y = [255, 231, 0, 255];
    const g = [58, 181, 75, 255];
    const a = [38, 123, 167, 255];
    // biome-ignore format:_
    const data = new Uint8Array([
      w, r, r, r, r, r, r, a, a, r, r, r, r, r, r, w,
      w, w, r, r, r, r, r, a, a, r, r, r, r, r, w, w,
      w, w, w, r, r, r, r, a, a, r, r, r, r, w, w, w,
      w, w, w, w, r, r, r, a, a, r, r, r, w, w, w, w,
      w, w, w, w, w, r, r, a, a, r, r, w, w, w, w, w,
      w, w, w, w, w, w, r, a, a, r, w, w, w, w, w, w,
      w, w, w, w, w, w, w, a, a, w, w, w, w, w, w, w,
      b, b, b, b, b, b, b, b, a, y, y, y, y, y, y, y,
      b, b, b, b, b, b, b, g, y, y, y, y, y, y, y, y,
      w, w, w, w, w, w, w, g, g, w, w, w, w, w, w, w,
      w, w, w, w, w, w, r, g, g, r, w, w, w, w, w, w,
      w, w, w, w, w, r, r, g, g, r, r, w, w, w, w, w,
      w, w, w, w, r, r, r, g, g, r, r, r, w, w, w, w,
      w, w, w, r, r, r, r, g, g, r, r, r, r, w, w, w,
      w, w, r, r, r, r, r, g, g, r, r, r, r, r, w, w,
      w, r, r, r, r, r, r, g, g, r, r, r, r, r, r, w,
    ].flat());
    return App.generateMips(data, 16);
  }

  private static createCheckedMipmap(): Mip[] {
    const ctx = document
      .createElement('canvas')
      .getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('2d コンテキストを取得できませんでした。');
    }
    const levels = [
      { size: 64, color: 'rgb(128,0,255)' },
      { size: 32, color: 'rgb(0,255,0)' },
      { size: 16, color: 'rgb(255,0,0)' },
      { size: 8, color: 'rgb(255,255,0)' },
      { size: 4, color: 'rgb(0,0,255)' },
      { size: 2, color: 'rgb(0,255,255)' },
      { size: 1, color: 'rgb(255,0,255)' },
    ];
    return levels.map(({ size, color }, i) => {
      ctx.canvas.width = size;
      ctx.canvas.height = size;
      ctx.fillStyle = i & 1 ? '#000' : '#fff';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, size / 2, size / 2);
      ctx.fillRect(size / 2, size / 2, size / 2, size / 2);
      return ctx.getImageData(0, 0, size, size);
    });
  }
}
