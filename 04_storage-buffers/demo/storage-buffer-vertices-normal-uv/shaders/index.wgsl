struct OurStruct {
    color: vec4f,
    offset: vec2f,
};

struct OtherStruct {
    scale: vec2f,
}

struct Vertex {
    position: vec2f,
    normal: vec3f,
    uv: vec2f,
}

struct VSOutput {
    @builtin(position) position: vec4f,
    @location(0) color: vec4f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
}

@group(0) @binding(0) var<storage, read> ourStructs: array<OurStruct>;
@group(0) @binding(1) var<storage, read> otherStructs: array<OtherStruct>;
@group(0) @binding(2) var<storage, read> vertices: array<Vertex>;

@vertex fn vs(
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32
) -> VSOutput {
    let otherStruct = otherStructs[instanceIndex];
    let ourStruct = ourStructs[instanceIndex];
    let v = vertices[vertexIndex];

    var vsOut: VSOutput;
    vsOut.position = vec4f(v.position * otherStruct.scale + ourStruct.offset, 0.0, 1.0);
    vsOut.color = ourStruct.color;
    vsOut.normal = v.normal;
    vsOut.uv = v.uv;

    return vsOut;
}

@fragment fn fs(vsOut: VSOutput) -> @location(0) vec4f {
    let lightDir = normalize(vec3f(1.0, 1.0, 0.5));
    let light = max(dot(normalize(vsOut.normal), lightDir), 0.0);
    let shade = 0.25 + 0.75 * light;

    let stripe = step(0.5, fract(vsOut.uv.x * 12.0));
    let tint = mix(1.0, 0.6, stripe);

    return vec4f(vsOut.color.rgb * shade * tint, vsOut.color.a);
}
