struct Uniforms {
    matrix: mat4x4f,
};

struct Vertex {
    @location(0) position: vec4f,
    @location(1) color: vec4f,
};

struct VSOutput {
    @builtin(position) position: vec4f,
    @location(0) color: vec4f,
};

@group(0) @binding(0) var<uniform> uni: Uniforms;

@vertex fn vs(vert: Vertex) -> VSOutput {
    var vsOut: VSOutput;

    vsOut.position = uni.matrix * vert.position;

    vsOut.color = vert.color;
    return vsOut;
}

@fragment fn fs(vsOut: VSOutput) -> @location(0) vec4f {
    return vsOut.color;
}
