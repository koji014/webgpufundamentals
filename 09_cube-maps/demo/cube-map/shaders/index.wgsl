struct Uniforms {
    matrix: mat4x4f,
}

struct Vertex {
    @location(0) position: vec4f,
}

struct VSOutput {
    @builtin(position) position: vec4f,
    @location(0) normal: vec3f,
}

@group(0) @binding(0) var<uniform> uni: Uniforms;

@vertex fn vs(vert: Vertex) -> VSOutput {
    var vsOutput: VSOutput;
    vsOutput.position = uni.matrix * vert.position;
    vsOutput.normal = normalize(vert.position.xyz);
    return vsOutput;
}

@group(0) @binding(1) var ourSampler: sampler;
@group(0) @binding(2) var ourTexture: texture_cube<f32>;

@fragment fn fs(fsInput: VSOutput) -> @location(0) vec4f {
    return textureSample(ourTexture, ourSampler, normalize(fsInput.normal));
}
