export type Mat3 = number[];

export const mat3 = {
  multiply(a: Mat3, b: Mat3): Mat3 {
    const a00 = a[0 * 3 + 0];
    const a01 = a[0 * 3 + 1];
    const a02 = a[0 * 3 + 2];
    const a10 = a[1 * 3 + 0];
    const a11 = a[1 * 3 + 1];
    const a12 = a[1 * 3 + 2];
    const a20 = a[2 * 3 + 0];
    const a21 = a[2 * 3 + 1];
    const a22 = a[2 * 3 + 2];
    const b00 = b[0 * 3 + 0];
    const b01 = b[0 * 3 + 1];
    const b02 = b[0 * 3 + 2];
    const b10 = b[1 * 3 + 0];
    const b11 = b[1 * 3 + 1];
    const b12 = b[1 * 3 + 2];
    const b20 = b[2 * 3 + 0];
    const b21 = b[2 * 3 + 1];
    const b22 = b[2 * 3 + 2];

    return [
      b00 * a00 + b01 * a10 + b02 * a20,
      b00 * a01 + b01 * a11 + b02 * a21,
      b00 * a02 + b01 * a12 + b02 * a22,
      b10 * a00 + b11 * a10 + b12 * a20,
      b10 * a01 + b11 * a11 + b12 * a21,
      b10 * a02 + b11 * a12 + b12 * a22,
      b20 * a00 + b21 * a10 + b22 * a20,
      b20 * a01 + b21 * a11 + b22 * a21,
      b20 * a02 + b21 * a12 + b22 * a22,
    ];
  },

  identity(): Mat3 {
    // biome-ignore format: _
    return [
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ];
  },

  projection(width: number, height: number): Mat3 {
    // biome-ignore format: _
    return [
      2 / width, 0, 0,
      0, -2 / height, 0,
      -1, 1, 1,
    ];
  },

  translation([tx, ty]: [number, number]): Mat3 {
    // biome-ignore format: _
    return [
      1, 0, 0,
      0, 1, 0,
      tx, ty, 1,
    ];
  },

  rotation(angleInRadians: number): Mat3 {
    const c = Math.cos(angleInRadians);
    const s = Math.sin(angleInRadians);
    // biome-ignore format: _
    return [
       c, s, 0,
      -s, c, 0,
       0, 0, 1,
    ];
  },

  scaling([sx, sy]: [number, number]): Mat3 {
    // biome-ignore format: _
    return [
      sx, 0, 0,
      0, sy, 0,
      0, 0, 1,
    ];
  },
};

// biome-ignore format: _
export const mat3ToPadded = (m: Mat3): number[] => [
  ...m.slice(0, 3), 0,
  ...m.slice(3, 6), 0,
  ...m.slice(6, 9), 0,
];
