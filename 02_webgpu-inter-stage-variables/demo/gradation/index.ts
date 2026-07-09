import triangle_wgsl from './index.wgsl';

const main = async () => {
  const getDevice = async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) {
      throw new Error('WebGPU対応ブラウザが必要です');
    }

    device.lost.then((info) => {
      console.error(`WebGPU device was lost: ${info.message}`);

      if (info.reason !== 'destroyed') {
        getDevice();
      }
    });

    return device;
  };

  const device = await getDevice();

  const canvas = document.querySelector<HTMLCanvasElement>('#webgpu-canvas');
  if (!canvas) {
    throw new Error('#webgpu-canvas が見つかりません。');
  }

  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new Error('webgpu コンテキストを取得できませんでした。');
  }

  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

  context.configure({ device, format: presentationFormat });

  const shaderModule = device.createShaderModule({
    label: 'our hardcoded rgb triangle shaders',
    code: triangle_wgsl,
  });

  const pipeline = device.createRenderPipeline({
    label: 'our hardcoded rgb triangle pipeline',
    layout: 'auto',
    vertex: {
      module: shaderModule,
      entryPoint: 'vs',
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs',
      targets: [{ format: presentationFormat }],
    },
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

  const render = () => {
    const currentTexture = context.getCurrentTexture();
    colorAttachment.view = currentTexture.createView();

    const encoder = device.createCommandEncoder({
      label: 'ender triangle encoder',
    });

    const pass = encoder.beginRenderPass(renderPassDescriptor);

    pass.setPipeline(pipeline);
    pass.draw(3);
    pass.end();

    const commandBuffer = encoder.finish();

    device.queue.submit([commandBuffer]);
  };

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;

      canvas.width = Math.max(
        1,
        Math.min(width, device.limits.maxTextureDimension2D),
      );
      canvas.height = Math.max(
        1,
        Math.min(height, device.limits.maxTextureDimension2D),
      );

      render();
    }
  });

  observer.observe(canvas);
};

main();
