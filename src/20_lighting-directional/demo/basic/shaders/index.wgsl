struct Uniforms {
    matrix: mat4x4f,
    color: vec4f,
    lightDirection: vec3f,
};

struct Vertex {
    @location(0) position: vec4f,
    @location(1) normal: vec3f,
};

struct VSOutput {
    @builtin(position) position: vec4f,
    @location(0) normal: vec3f,
};

@group(0) @binding(0) var<uniform> uni: Uniforms;

@vertex fn vs(vert: Vertex) -> VSOutput {
    var vsOut: VSOutput;
    vsOut.position = uni.matrix * vert.position;
    vsOut.normal = vert.normal;
    return vsOut;
}

@fragment fn fs(vsOut: VSOutput) -> @location(0) vec4f {
    let normal = normalize(vsOut.normal);

    let light = dot(normal, -uni.lightDirection);

    let color = uni.color.rgb * light;
    return vec4f(color, uni.color.a);
}
