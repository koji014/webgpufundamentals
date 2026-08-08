struct VOut {
    @builtin(position) position: vec4f,
    @location(0) @interpolate(perspective, centroid) baryCoord: vec3f,
};

@vertex fn vs(
    @builtin(vertex_index) vertexIndex: u32
) -> VOut {
    let pos = array(
        vec2f( 0.0,  0.5),  // top center
        vec2f(-0.5, -0.5),  // bottom left
        vec2f( 0.5, -0.5),  // bottom right
    );
    let bary = array(
        vec3f(1, 0, 0),
        vec3f(0, 1, 0),
        vec3f(0, 0, 1),
    );
    var vout: VOut;
    vout.position = vec4f(pos[vertexIndex], 0.0, 1.0);
    vout.baryCoord = bary[vertexIndex];
    return vout;
}

@fragment fn fs(vin: VOut) -> @location(0) vec4f {
    let allAbove0 = all(vin.baryCoord >= vec3f(0));
    let allBelow1 = all(vin.baryCoord <= vec3f(1));
    let inside = allAbove0 && allBelow1;
    let red = vec4f(1, 0, 0, 1);
    let yellow = vec4f(1, 1, 0, 1);
    return select(yellow, red, inside);
}
