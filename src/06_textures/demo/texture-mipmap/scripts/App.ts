import GUI from 'muigui';
import index_wgsl from '../shaders/index.wgsl';

interface UniformOffsets {
  scale: number;
  offset: number;
}

interface Mip {
  data: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
}

interface Settings {
  addressModeU: GPUAddressMode;
  addressModeV: GPUAddressMode;
  magFilter: GPUFilterMode;
  minFilter: GPUFilterMode;
  scale: number;
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
    bindGroups: GPUBindGroup[];
    uniformOffsets: UniformOffsets;
    uniformBuffer: GPUBuffer;
    uniformValues: Float32Array<ArrayBuffer>;
    settings: Settings;
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

    const mips = App.generateMips(textureData, textureWidth);

    const texture = device.createTexture({
      label: 'yellow F on red',
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

    const settings: Settings = {
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      magFilter: 'linear',
      minFilter: 'linear',
      scale: 1,
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
    gui.add(settings, 'scale', 0.5, 6);
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

    const scaleX = (4 / this.canvas.width) * this.settings.scale;
    const scaleY = (4 / this.canvas.height) * this.settings.scale;

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
      const width = (entry.contentBoxSize[0].inlineSize / 64) | 0;
      const height = (entry.contentBoxSize[0].blockSize / 64) | 0;

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
      return src.subarray(offset, offset + 4);
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
}
