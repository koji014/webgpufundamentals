struct Uniforms {
    color: vec4f,
    matrix: mat4x4f,
};

struct Vertex {
    @location(0) position: vec4f,
};

struct VSOutput {
    @builtin(position) position: vec4f,
};

@group(0) @binding(0) var<uniform> uni: Uniforms;

@vertex fn vs(vert: Vertex) -> VSOutput {
    var vsOut: VSOutput;
    vsOut.position = uni.matrix * vert.position;
    return vsOut;
}

@fragment fn fs(vsOut: VSOutput) -> @location(0) vec4f {
    return uni.color;
}
