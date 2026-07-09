@fragment fn fs(@builtin(position) pixelPosition: vec4f) -> @location(0) vec4f {
    let red = vec4f(1, 0, 0, 1);
    let cyan = vec4f(0, 1, 1, 1);

    let grid = vec2u(pixelPosition.xy) / 8;
    let checker = (grid.x + grid.y) % 2 == 1;

    return select(red, cyan, checker);
}