# inter-stage 変数（ステージ間変数）

https://webgpufundamentals.org/webgpu/lessons/ja/webgpu-inter-stage-variables.html

---

- 頂点シェーダの出力をフラグメントシェーダの入力へ渡す仕組み。
- 頂点で出した値がラスタライズ時に三角形の内部で補間され、各ピクセルのフラグメントシェーダに届く。
- WebGL の `varying`（`out`/`in`）と同じ役割で、補間の入り方も同じ。
- テクスチャ座標や法線を頂点からピクセルへ補間して渡す、といった用途が中心。

## 頂点ごとの色を渡してグラデーションにする

- 頂点シェーダの出力を構造体にまとめ、`@location(0)` で色を持たせる。
- フラグメントシェーダは同じ `@location(0)` で受け取る。

```wgsl
struct OurVertexShaderOutput {
  @builtin(position) position: vec4f, // GPU が描画に使う位置（クリップ空間）
  @location(0) color: vec4f,          // inter-stage 変数。フラグメントへ渡す
};

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> OurVertexShaderOutput {
  let pos = array(vec2f(0.0, 0.5), vec2f(-0.5, -0.5), vec2f(0.5, -0.5));
  var color = array<vec4f, 3>(
    vec4f(1, 0, 0, 1), // 赤
    vec4f(0, 1, 0, 1), // 緑
    vec4f(0, 0, 1, 1), // 青
  );

  var vsOutput: OurVertexShaderOutput;
  vsOutput.position = vec4f(pos[vertexIndex], 0.0, 1.0);
  vsOutput.color = color[vertexIndex]; // 頂点ごとに別の色
  return vsOutput;
}

@fragment
fn fs(@location(0) color: vec4f) -> @location(0) vec4f {
  return color; // 3 頂点の色が補間されて渡ってくる
}
```

- 頂点 3 つに赤・緑・青を割り当てると、三角形内部は補間されてグラデーションになる。

フラグメントシェーダの1行には `@location(0)` が2回出てくるが、つなぐ相手はそれぞれ異なる。

```wgsl
fn fs(@location(0) color: vec4f) -> @location(0) vec4f {
//    ^ 入力：頂点出力の @location(0)   ^ 出力：colorAttachments[0]（描画先）
```

| `@location(n)` | つなぐ相手 |
| --- | --- |
| fs の入力 | 頂点出力の同じ番号（inter-stage 変数） |
| fs の出力 | `colorAttachments[n]`（描画先） |

- 番号は 0 固定ではなく、対応する両者で一致していればよい（vs 出力 `@location(3)` と fs 入力 `@location(3)` でも届く）。
- fs 出力側は書き込み先の attachment が実在する範囲でのみ使え、複数の描画先へ同時に書く MRT（WebGL2 の複数 draw buffers に相当）で `@location(1)`, `@location(2)`… を使い分ける。
    - 普段の1枚描画は `colorAttachments` が `[0]` だけなので fs 出力も `@location(0)`。
    > colorAttachments[0]は、フラグメントシェーダの返り値の設定で記述したlocation(0)に対応するものです。
    https://webgpufundamentals.org/webgpu/lessons/ja/webgpu-fundamentals.html

## location さえ合えば構造体もモジュールも別でよい

inter-stage 変数を結び付けるのは `@location(n)` の番号だけ。

- 頂点側とフラグメント側で同じ構造体を使う必要はない（片方だけ構造体・片方は引数でも動く）
- モジュールも別でよい。checkerboard デモは頂点とフラグメントを別々のシェーダモジュール（`vsModule` / `fsModule`）に分けて `createRenderPipeline` に渡しており、別モジュールでも location で結び付く

## `@builtin(position)` は頂点とフラグメントで意味が違う

| | 頂点シェーダ | フラグメントシェーダ |
| --- | --- | --- |
| 入出力 | 出力 | 入力 |
| 中身 | クリップ空間の座標（-1〜+1） | ピクセル座標（各ピクセル中心の値） |

- `@builtin(position)` は builtin であって location でつなぐ inter-stage 変数ではない。
- 頂点とフラグメントで名前は同じでも中身は無関係の別変数で、頂点側で書いた値がそのままフラグメントに来るわけではない。
- フラグメント側の入力は WebGL の `gl_FragCoord` に相当する。

これを使うと、頂点から何も渡さなくてもピクセル座標だけで模様を描ける。checkerboard デモはピクセル座標を 8 で割った格子で市松模様を作る。

```wgsl
@fragment
fn fs(@builtin(position) pixelPosition: vec4f) -> @location(0) vec4f {
  let red = vec4f(1, 0, 0, 1);
  let cyan = vec4f(0, 1, 1, 1);

  let grid = vec2u(pixelPosition.xy) / 8;      // 8px ごとの格子インデックス
  let checker = (grid.x + grid.y) % 2 == 1;

  return select(red, cyan, checker); // checker が true なら cyan、false なら red
}
```

- `select(a, b, cond)` は `cond` が真なら `b`、偽なら `a` を返す WGSL 組み込み関数（三項演算子に相当）。
- この模様はピクセル座標基準なので canvas 解像度で見え方が変わる。
- ピクセル座標で模様を描くのはあまり一般的でなく、通常はテクスチャを使う。

## 補間の指定

補間の仕方は inter-stage 変数に `@interpolate(type, sampling)` を付けて変えられる。location と並べて書く。

```wgsl
struct OurVertexShaderOutput {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) color: vec4f,             // 補間しない
  @location(1) @interpolate(perspective, centroid) uv: vec2f, // type と sampling を両方指定
};
```

type（どう補間するか）

| type | 意味 |
| --- | --- |
| `perspective` | 透視補正あり（3次元のパースに合わせて補間）。既定 |
| `linear` | 線形補間。透視補正しない |
| `flat` | 補間しない |

sampling（どこの値をサンプリングするか）

| sampling | 意味 |
| --- | --- |
| `center` | ピクセルの中心で補間する。既定 |
| `centroid` | 三角形が覆っている範囲の内側で補間する（後述） |
| `sample` | サンプルごとに補間する。フラグメントシェーダが各サンプルごとに実行される |

`flat` のときは sampling に `first`（プリミティブの最初の頂点の値・既定）/ `either`（最初か最後どちらかの頂点の値）を使う。

整数型を inter-stage 変数で渡す場合は補間できないので `flat` が必須。それ以外は既定のままで足りることがほとんど。

### centroid は MSAA のときのエッジ対策

`center` と `centroid` の違いは **MSAA（マルチサンプリングによるアンチエイリアス）を使ったときだけ**現れる。

MSAA では 1 ピクセルの中に判定用のサンプル点が複数ある。三角形の辺にかかったピクセルでは、そのうち一部のサンプルだけが三角形の内側に入り、**ピクセルの中心が三角形の外に出る**ことがある。

```
   ┌───────────┐
   │●╲     ●   │   ● = サンプル点、╲ = 三角形の辺
   │  ╲  ×     │   左上の ● だけ三角形の内側
   │   ╲    ●  │   ピクセル中心 × は三角形の【外】
   └─── ╲──────┘
```

- `center`：中心 × で補間する。× は三角形の外なので、補間値を三角形の**外へはみ出して**計算してしまう。テクスチャ座標なら 1.0 を超えるなど範囲外の値になり、エッジににじみ・ゴミが出ることがある。
- `centroid`：補間する点を、三角形が実際に覆っているサンプル（この図では左上）の**内側へ寄せる**。値が三角形の内側に収まり、はみ出しによる破綻が起きない。

MSAA を使っていなければサンプルは実質 1 点なので、`center` と `centroid` に違いは出ない。普段は既定（`center`）でよく、MSAA を有効にしてエッジが破綻したときの対処に使う。

これは WebGL2（GLSL ES 3.0）の `centroid` 修飾子（`centroid out vec2 vTexCoord;`）と同等。

- WebGL2 の centroid（図解が分かりやすい）: https://wgld.org/d/webgl2/w013.html
