import { mat4 } from 'wgpu-matrix';
import videoUrl from '../../../assets/pexels-anna-bondarenko-5534310-540p.mp4';
import index_wgsl from '../shaders/index.wgsl';

interface ObjectInfo {
  sampler: GPUSampler;
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
  private readonly video: HTMLVideoElement;
  private readonly colorAttachment: GPURenderPassColorAttachment;
  private readonly renderPassDescriptor: GPURenderPassDescriptor;
  private rafId?: number;
  private observer?: ResizeObserver;

  private constructor(fields: {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    pipeline: GPURenderPipeline;
    objectInfos: ObjectInfo[];
    video: HTMLVideoElement;
    colorAttachment: GPURenderPassColorAttachment;
    renderPassDescriptor: GPURenderPassDescriptor;
  }) {
    this.canvas = fields.canvas;
    this.device = fields.device;
    this.context = fields.context;
    this.pipeline = fields.pipeline;
    this.objectInfos = fields.objectInfos;
    this.video = fields.video;
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

    const matrixOffset = 0;

    // 外部テクスチャはミップを持てないので mipmapFilter は不要。組み合わせは 4 通り
    const objectInfos: ObjectInfo[] = [];
    for (let i = 0; i < 4; ++i) {
      const sampler = device.createSampler({
        addressModeU: 'repeat',
        addressModeV: 'repeat',
        magFilter: i & 1 ? 'linear' : 'nearest',
        minFilter: i & 2 ? 'linear' : 'nearest',
      });

      const uniformBufferSize = 16 * 4; // matrix is 16 32bit floats (4bytes each)
      const uniformBuffer = device.createBuffer({
        label: 'uniforms for quad',
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const uniformValues = new Float32Array(uniformBufferSize / 4);
      const matrix = uniformValues.subarray(matrixOffset, 16);

      // importExternalTexture を呼ぶまでテクスチャが無く、バインドグループを事前に作れない
      // レンダリング時に必要な情報だけ保存しておく
      objectInfos.push({ sampler, matrix, uniformValues, uniformBuffer });
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
      video,
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
    this.video.pause();
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

    // 外部テクスチャは現在のタスクが終わるまでしか有効でないので、毎フレーム取得する
    const texture = this.device.importExternalTexture({ source: this.video });

    this.objectInfos.forEach(
      ({ sampler, matrix, uniformBuffer, uniformValues }, i) => {
        // 新しいテクスチャを渡すため、バインドグループも毎フレーム作り直す
        const bindGroup = this.device.createBindGroup({
          layout: this.pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: sampler },
            { binding: 1, resource: texture },
            { binding: 2, resource: uniformBuffer },
          ],
        });

        const xSpacing = 1.2;
        const ySpacing = 0.5;
        const zDepth = 1;

        const x = (i % 2) - 0.5;
        const y = i < 2 ? 1 : -1;

        mat4.translate(
          viewProjectionMatrix,
          [x * xSpacing, y * ySpacing, -zDepth * 0.5],
          matrix,
        );
        mat4.rotateX(matrix, 0.25 * Math.PI * Math.sign(y), matrix);
        mat4.scale(matrix, [1, -1, 1], matrix);
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
