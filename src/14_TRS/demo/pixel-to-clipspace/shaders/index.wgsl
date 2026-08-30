struct Uniforms {
    color: vec4f,
    resolution: vec2f,
};

struct Vertex {
    @location(0) position: vec2f,
};

struct VSOutput {
    @builtin(position) position: vec4f,
};

@group(0) @binding(0) var<uniform> uni: Uniforms;

@vertex fn vs(vert: Vertex) -> VSOutput {
    var vsOut: VSOutput;

    let position = vert.position;

    // ピクセル座標を 0.0 ~ 1.0 に変換する
    let zeroToOne = position / uni.resolution;

    // 0 ~ 1 を 0 ~ 2 に変換する
    let zeroToTwo = zeroToOne * 2.0;

    // 0 ~ 2 を -1 ~ +1 （クリップ空間）に変換する
    let flippedClipSpace = zeroToTwo - 1.0;

    // Y を反転する
    let clipSpace = flippedClipSpace * vec2f(1, -1);

    vsOut.position = vec4f(clipSpace, 0.0, 1.0);
    return vsOut;
}

@fragment fn fs(vsOut: VSOutput) -> @location(0) vec4f {
    return uni.color;
}
