precision highp float;

centroid in vec3 vBary;
out vec4 fragColor;

void main() {
    bool allAbove0 = all(greaterThanEqual(vBary, vec3(0.0)));
    bool allBelow1 = all(lessThanEqual(vBary, vec3(1.0)));
    bool inside = allAbove0 && allBelow1;
    vec4 red = vec4(1.0, 0.0, 0.0, 1.0);
    vec4 yellow = vec4(1.0, 1.0, 0.0, 1.0);
    fragColor = mix(yellow, red, bvec4(inside));
}
