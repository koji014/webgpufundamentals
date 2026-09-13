struct Uniforms {
    normalMatrix: mat3x3f,
    worldViewProjection: mat4x4f,
    world: mat4x4f,
    color: vec4f,
    lightWorldPosition: vec3f,
    viewWorldPosition: vec3f,
    shininess: f32,
};

struct Vertex {
    @location(0) position: vec4f,
    @location(1) normal: vec3f,
};

struct VSOutput {
    @builtin(position) position: vec4f,
    @location(0) normal: vec3f,
    @location(1) surfaceToLight: vec3f,
    @location(2) surfaceToView: vec3f,
};

@group(0) @binding(0) var<uniform> uni: Uniforms;

@vertex fn vs(vert: Vertex) -> VSOutput {
    var vsOut: VSOutput;
    vsOut.position = uni.worldViewProjection * vert.position;

    vsOut.normal = uni.normalMatrix * vert.normal;

    let surfaceWorldPosition = (uni.world * vert.position).xyz;

    vsOut.surfaceToLight = uni.lightWorldPosition - surfaceWorldPosition;

    vsOut.surfaceToView = uni.viewWorldPosition - surfaceWorldPosition;

    return vsOut;
}

@fragment fn fs(vsOut: VSOutput) -> @location(0) vec4f {
    let normal = normalize(vsOut.normal);

    let surfaceToLightDirection = normalize(vsOut.surfaceToLight);
    let surfaceToViewDirection = normalize(vsOut.surfaceToView);
    let halfVector = normalize(surfaceToLightDirection + surfaceToViewDirection);

    let light = dot(normal, surfaceToLightDirection);

    var specular = dot(normal, halfVector);
    specular = select(
        0.0, // 条件が false の場合の値
        pow(specular, uni.shininess), // 条件が true の場合の値
        specular > 0.0 // 条件
    );

    let color = uni.color.rgb * light + specular;
    return vec4f(color, uni.color.a);
}
