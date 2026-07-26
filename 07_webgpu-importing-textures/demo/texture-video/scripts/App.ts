import { mat4 } from 'wgpu-matrix';
import videoUrl from '../assets/golden-retriever-360-no-audio.webm';
import generateMips_wgsl from '../shaders/generateMips.wgsl';
import index_wgsl from '../shaders/index.wgsl';

type TextureSource = ImageBitmap | HTMLCanvasElement | HTMLVideoElement;

interface ObjectInfo {
  bindGroup: GPUBindGroup;
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
  private readonly texture: GPUTexture;
  private readonly video: HTMLVideoElement;
  private readonly colorAttachment: GPURenderPassColorAttachment;
  private readonly renderPassDescriptor: GPURenderPassDescriptor;
  // private readonly alwaysUpdateVideo: boolean;
  // private haveNewVideoFrame = false;
  private rafId?: number;
  // private videoFrameId?: number;
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
    video: HTMLVideoElement;
    // alwaysUpdateVideo: boolean;
    colorAttachment: GPURenderPassColorAttachment;
    renderPassDescriptor: GPURenderPassDescriptor;
  }) {
    this.canvas = fields.canvas;
    this.device = fields.device;
    this.context = fields.context;
    this.pipeline = fields.pipeline;
    this.objectInfos = fields.objectInfos;
    this.texture = fields.texture;
    this.video = fields.video;
    // this.alwaysUpdateVideo = fields.alwaysUpdateVideo;
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

    const video = document.createElement('video');
    video.muted = true;
    video.loop = true;
    video.preload = 'auto';
    video.src = videoUrl;
    await App.waitForClick();
    await App.startPlayingAndWaitForVideo(video);

    canvas.addEventListener('click', () => {
      if (video.paused) {
        video.play();
      } else {
        video.pause();
      }
    });

    // // requestVideoFrameCallback 非対応なら毎フレーム更新するしかない
    // const alwaysUpdateVideo = typeof video.requestVideoFrameCallback !== 'function';

    const texture = App.createTextureFromSource(device, video, { mips: true });

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
      video,
      // alwaysUpdateVideo,
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
    // // 新フレーム到着ごとにフラグを立てる。以降 render() はこのフラグを見てコピーする
    // if (!this.alwaysUpdateVideo) {
    //   this.requestVideoFrame();
    // }
    this.rafId = requestAnimationFrame(this.render);
  }

  dispose() {
    if (this.rafId !== undefined) {
      cancelAnimationFrame(this.rafId);
      this.rafId = undefined;
    }
    // if (this.videoFrameId !== undefined) {
    //   this.video.cancelVideoFrameCallback(this.videoFrameId);
    //   this.videoFrameId = undefined;
    // }
    this.observer?.disconnect();
    this.observer = undefined;
    this.video.pause();
  }

  // private requestVideoFrame() {
  //   this.videoFrameId = this.video.requestVideoFrameCallback(() => {
  //     this.haveNewVideoFrame = true;
  //     this.requestVideoFrame();
  //   });
  // }

  private render() {
    // rAF はディスプレイのリフレッシュ間隔で呼ばれるので、ビデオの実フレームレートより速いことが多い
    // 新フレームが来たときだけコピー（＋ミップ再生成）する
    // if (this.alwaysUpdateVideo || this.haveNewVideoFrame) {
    //   this.haveNewVideoFrame = false;
    //   App.copySourceToTexture(this.device, this.texture, this.video);
    // }
    App.copySourceToTexture(this.device, this.texture, this.video);

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

  private static numMipLevels(...sizes: number[]): number {
    const maxSize = Math.max(...sizes);
    return (1 + Math.log2(maxSize)) | 0;
  }

  private static getSourceSize(source: TextureSource): [number, number] {
    return [
      (source as HTMLVideoElement).videoWidth || source.width,
      (source as HTMLVideoElement).videoHeight || source.height,
    ];
  }

  private static copySourceToTexture(
    device: GPUDevice,
    texture: GPUTexture,
    source: TextureSource,
    { flipY }: { flipY?: boolean } = {},
  ) {
    const [width, height] = App.getSourceSize(source);
    device.queue.copyExternalImageToTexture(
      { source, flipY },
      { texture },
      { width, height },
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
    const [width, height] = App.getSourceSize(source);
    const texture = device.createTexture({
      label: 'texture from video',
      format: 'rgba8unorm',
      mipLevelCount: options.mips ? App.numMipLevels(width, height) : 1,
      size: [width, height],
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

  private static startPlayingAndWaitForVideo(
    video: HTMLVideoElement,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      video.addEventListener('error', reject);
      if (typeof video.requestVideoFrameCallback === 'function') {
        video.requestVideoFrameCallback(() => resolve());
      } else {
        const timeWatcher = () => {
          if (video.currentTime > 0) {
            resolve();
          } else {
            requestAnimationFrame(timeWatcher);
          }
        };
        timeWatcher();
      }
      video.play().catch(reject);
    });
  }

  private static waitForClick(): Promise<void> {
    return new Promise((resolve) => {
      window.addEventListener(
        'click',
        () => {
          const start = document.querySelector<HTMLElement>('#start');
          if (start) {
            start.style.display = 'none';
          }
          resolve();
        },
        { once: true },
      );
    });
  }
}
