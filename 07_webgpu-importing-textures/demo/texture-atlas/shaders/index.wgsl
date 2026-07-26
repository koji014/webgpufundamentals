struct Uniforms {
    matrix: mat4x4f,
}

struct Vertex {
    @location(0) position: vec4f,
    @location(1) texcoord: vec2f,
}

struct VSOutput {
    @builtin(position) position: vec4f,
    @location(0) texcoord: vec2f,
}

@group(0) @binding(0) var<uniform> uni: Uniforms;

@vertex fn vs(vert: Vertex) -> VSOutput {
    var vsOutput: VSOutput;
    vsOutput.position = uni.matrix * vert.position;
    vsOutput.texcoord = vert.texcoord;
    return vsOutput;
}

@group(0) @binding(1) var ourSampler: sampler;
@group(0) @binding(2) var ourTexture: texture_2d<f32>;

@fragment fn fs(fsInput: VSOutput) -> @location(0) vec4f {
    return textureSample(ourTexture, ourSampler, fsInput.texcoord);
}
