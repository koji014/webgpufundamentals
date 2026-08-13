centroid out vec3 vBary;

void main() {
    const vec2 pos[3] = vec2[](
        vec2( 0.0,  0.5), // top center
        vec2(-0.5, -0.5), // bottom left
        vec2( 0.5, -0.5)  // bottom right
    );
    const vec3 bary[3] = vec3[](
        vec3(1.0, 0.0, 0.0),
        vec3(0.0, 1.0, 0.0),
        vec3(0.0, 0.0, 1.0)
    );

    vBary = bary[gl_VertexID];
    gl_Position = vec4(pos[gl_VertexID], 0.0, 1.0);
}
