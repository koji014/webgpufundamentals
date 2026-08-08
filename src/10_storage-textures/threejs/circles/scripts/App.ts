import * as THREE from 'three';
import index_frag from '../shaders/index.frag';
import index_vert from '../shaders/index.vert';

export class App {
  static RENDERER_PARAM = {
    clearColor: 0x4d4d4d,
    alpha: 1,
  };

  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly material: THREE.RawShaderMaterial;

  private constructor(fields: {
    canvas: HTMLCanvasElement;
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: THREE.RawShaderMaterial;
  }) {
    this.canvas = fields.canvas;
    this.renderer = fields.renderer;
    this.scene = fields.scene;
    this.camera = fields.camera;
    this.material = fields.material;
  }

  static create(canvas: HTMLCanvasElement): App {
    const renderer = new THREE.WebGLRenderer({ canvas });
    const clearColor = new THREE.Color(App.RENDERER_PARAM.clearColor);
    renderer.setClearColor(clearColor, App.RENDERER_PARAM.alpha);

    const camera = new THREE.Camera();
    const scene = new THREE.Scene();

    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.RawShaderMaterial({
      vertexShader: index_vert,
      fragmentShader: index_frag,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uResolution: { value: new THREE.Vector2() },
      },
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    return new App({ canvas, renderer, scene, camera, material });
  }

  start() {
    const observer = new ResizeObserver((entries) => this.resize(entries));
    observer.observe(this.canvas);
  }

  private render() {
    this.renderer.render(this.scene, this.camera);
  }

  private resize(entries: ResizeObserverEntry[]) {
    const maxTextureSize = this.renderer.capabilities.maxTextureSize;

    for (const entry of entries) {
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;

      const drawWidth = Math.max(1, Math.min(width, maxTextureSize));
      const drawHeight = Math.max(1, Math.min(height, maxTextureSize));

      this.renderer.setSize(drawWidth, drawHeight, false);
      this.material.uniforms.uResolution.value.set(drawWidth, drawHeight);
    }

    this.render();
  }
}
