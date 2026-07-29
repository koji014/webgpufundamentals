uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;

out vec2 vTexCoord;

void main() {
    const vec2 pos[6] = vec2[](
        // 1st triangle
        vec2(0.0, 0.0), // center
        vec2(1.0, 0.0), // right, center
        vec2(0.0, 1.0), // center, top
        // 2nd triangle
        vec2(0.0, 1.0), // center, top
        vec2(1.0, 0.0), // right, center
        vec2(1.0, 1.0)  // right, top
    );

    vec2 xy = pos[gl_VertexID];
    vTexCoord = xy;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(xy, 0.0, 1.0);
}
