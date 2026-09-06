import { mat4 } from './mat4';

export class MatrixStack {
  #matrix: Float32Array = mat4.identity();
  #stack: Float32Array[] = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.#matrix = mat4.identity();
    this.#stack = [];
    return this;
  }

  save() {
    this.#stack.push(this.#matrix);
    this.#matrix = mat4.copy(this.#matrix);
    return this;
  }

  restore() {
    this.#matrix = this.#stack.pop() as Float32Array;
    return this;
  }

  get() {
    return this.#matrix;
  }

  set(matrix: Float32Array) {
    return this.#matrix.set(matrix);
  }

  translate(translation: number[]) {
    mat4.translate(this.#matrix, translation, this.#matrix);
    return this;
  }

  rotateX(angle: number) {
    mat4.rotateX(this.#matrix, angle, this.#matrix);
    return this;
  }

  rotateY(angle: number) {
    mat4.rotateY(this.#matrix, angle, this.#matrix);
    return this;
  }

  rotateZ(angle: number) {
    mat4.rotateZ(this.#matrix, angle, this.#matrix);
    return this;
  }

  scale(scale: number[]) {
    mat4.scale(this.#matrix, scale, this.#matrix);
    return this;
  }
}
