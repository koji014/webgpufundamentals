import * as THREE from 'three';
import videoUrl from '../../../assets/pexels-anna-bondarenko-5534310-540p.mp4';
import external_video_frag from '../shaders/external-video.frag';
import external_video_vert from '../shaders/external-video.vert';

export class App {
  static RENDERER_PARAM = {
    clearColor: 0x4d4d4d, // [0.3, 0.3, 0.3, 1]
    alpha: 1,
  };

  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;

  private constructor(fields: {
    canvas: HTMLCanvasElement;
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
  }) {
    this.canvas = fields.canvas;
    this.renderer = fields.renderer;
    this.scene = fields.scene;
    this.camera = fields.camera;

    this.render = this.render.bind(this);
  }

  static async create(canvas: HTMLCanvasElement): Promise<App> {
    const renderer = new THREE.WebGLRenderer({ canvas });
    const clearColor = new THREE.Color(App.RENDERER_PARAM.clearColor);
    renderer.setClearColor(clearColor, App.RENDERER_PARAM.alpha);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(60, 1, 1, 2000);
    camera.position.set(0, 0, 2);
    camera.lookAt(0, 0, 0);

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

    const geometry = new THREE.BufferGeometry();
    const positions = Array.from({ length: 6 }, () => [0, 0, 0]).flat();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );

    for (let i = 0; i < 4; ++i) {
      const texture = new THREE.VideoTexture(video);
      texture.flipY = false;
      texture.magFilter = i & 1 ? THREE.LinearFilter : THREE.NearestFilter;
      texture.minFilter = i & 2 ? THREE.LinearFilter : THREE.NearestFilter;

      const material = new THREE.RawShaderMaterial({
        vertexShader: external_video_vert,
        fragmentShader: external_video_frag,
        glslVersion: THREE.GLSL3,
        side: THREE.DoubleSide, // WebGPU では既定で両面表示（カリング無効）
        uniforms: {
          map: { value: texture },
        },
      });

      const mesh = new THREE.Mesh(geometry, material);

      const xSpacing = 1.2;
      const ySpacing = 0.5;
      const zDepth = 1;

      const x = (i % 2) - 0.5;
      const y = i < 2 ? 1 : -1;

      const transform = new THREE.Matrix4();
      const temp = new THREE.Matrix4();

      transform.multiply(
        temp.makeTranslation(x * xSpacing, y * ySpacing, -zDepth * 0.5),
      );
      transform.multiply(temp.makeRotationX(0.25 * Math.PI * Math.sign(y)));
      transform.multiply(temp.makeScale(1, -1, 1));
      transform.multiply(temp.makeTranslation(-0.5, -0.5, 0));

      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(transform);
      mesh.matrixWorldNeedsUpdate = true;

      scene.add(mesh);
    }

    return new App({ canvas, renderer, scene, camera });
  }

  start() {
    const observer = new ResizeObserver((entries) => this.resize(entries));
    observer.observe(this.canvas);
    this.renderer.setAnimationLoop(this.render);
  }

  private render() {
    this.renderer.render(this.scene, this.camera);
  }

  private resize(entries: ResizeObserverEntry[]) {
    const maxTextureDimension2D = this.renderer.capabilities.maxTextureSize;

    for (const entry of entries) {
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;

      const drawWidth = Math.max(1, Math.min(width, maxTextureDimension2D));
      const drawHeight = Math.max(1, Math.min(height, maxTextureDimension2D));

      this.renderer.setSize(drawWidth, drawHeight, false);
      this.camera.aspect = drawWidth / drawHeight;
      this.camera.updateProjectionMatrix();
    }
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
