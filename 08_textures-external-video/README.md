# ビデオの効率的な使用

https://webgpufundamentals.org/webgpu/lessons/ja/webgpu-textures-external-video.html

---

## 外部テクスチャ

### 01. ビデオを使用するための別の方法

- [前章](../07_importing-textures/README.md)では `copyExternalImageToTexture` で、ビデオの現在フレームを既存テクスチャに**コピー**していた
- もう一つの方法として `importExternalTexture` がある
- 戻り値である `GPUExternalTexture` はビデオのデータを直接指すので、コピーが作られない（ゼロコピー）。

```ts
const texture = device.importExternalTexture({ source: video });
```

| WebGL | WebGPU（`copyExternalImageToTexture`） | WebGPU（`importExternalTexture`） |
|---|---|---|
| 毎フレーム `gl.texImage2D(..., video)` でフレームをテクスチャへコピー | フレームを RGBA テクスチャへコピー（前章） | ビデオを直接参照。コピーなし |

- 実際にコピーが起きないか否かはブラウザ実装次第。WebGPU 仕様はコピー不要を期待して設計されている（[脚注1](https://webgpufundamentals.org/webgpu/lessons/ja/webgpu-textures-external-video.html#fn1)）。

### 02. 外部テクスチャ使用時の注意点（制約）

`importExternalTexture` でテクスチャを使用するに際して、制約がある。

#### （ i ） テクスチャの寿命が非常に短い

- 有効なのは**現在の JavaScript タスクが終わるまで**。多くのアプリでは `requestAnimationFrame` のコールバック（あるいはレンダリングを駆動する `requestVideoFrameCallback` / `setTimeout` / `mousemove` など）が終わると期限切れになる。
- ビデオを再び使うには `importExternalTexture` を呼び直す。
- 呼ぶたびに新しいテクスチャを渡すため、**バインドグループも作り直す**。事前には作れないので、レンダリング時に使う情報（サンプラー・行列・ユニフォームバッファ）だけ先に保存しておく。

    ```diff
    for (let i = 0; i < 4; ++i) {
        const sampler = device.createSampler({ ... });
        // ... uniformBuffer など

    -   // 前章：テクスチャが先にあるので、バインドグループを事前に作れた
    -   const bindGroups = textures.map(texture =>
    -     device.createBindGroup({
    -       layout: pipeline.getBindGroupLayout(0),
    -       entries: [
    -         { binding: 0, resource: sampler },
    -         { binding: 1, resource: texture },
    -         { binding: 2, resource: uniformBuffer },
    -       ],
    -     }));

        // importExternalTexture を呼ぶまでテクスチャが無い。後で使う情報だけ保存
    -   objectInfos.push({ bindGroups, matrix, uniformValues, uniformBuffer });
    +   objectInfos.push({ sampler, matrix, uniformValues, uniformBuffer });
    }
    ```

    ```diff
    function render() {
    -   copySourceToTexture(device, texture, video); // 前章：フレームをコピー
        // ...
        const pass = encoder.beginRenderPass(renderPassDescriptor);
        pass.setPipeline(pipeline);

    +   // 外部テクスチャは今のタスクが終わると失効するので、毎フレーム取得する
    +   const texture = device.importExternalTexture({ source: video });

        objectInfos.forEach(({ sampler, matrix, uniformBuffer, uniformValues }, i) => {
    +     // 新しいテクスチャを渡すため、バインドグループも毎フレーム作り直す
    +     const bindGroup = device.createBindGroup({
    +       layout: pipeline.getBindGroupLayout(0),
    +       entries: [
    +         { binding: 0, resource: sampler },
    +         { binding: 1, resource: texture },
    +         { binding: 2, resource: uniformBuffer },
    +       ],
    +     });
        // ...
        pass.setBindGroup(0, bindGroup);
        pass.draw(6);
        });
    }
    ```

- 仕様上は同じテクスチャを返すことができると記載（必須ではない）。`oldTexture === device.importExternalTexture(...)` で同一か確認でき、同じなら既存のバインドグループを使い回せる（[脚注2](https://webgpufundamentals.org/webgpu/lessons/ja/webgpu-textures-external-video.html#fn2)）。


#### （ ii ） シェーダーでは `texture_2d<f32>` ではなく `texture_external` を使う

- これまでのテクスチャは `texture_2d<f32>` だった
- 外部テクスチャは `texture_external` のバインディングポイントにのみバインドできる

```diff
  @group(0) @binding(0) var ourSampler: sampler;
- @group(0) @binding(1) var ourTexture: texture_2d<f32>;
+ @group(0) @binding(1) var ourTexture: texture_external;
```

#### （ iii ） サンプリングは `textureSample` ではなく `textureSampleBaseClampToEdge` を使う

- 外部テクスチャは `textureSample` を使えず、`textureSampleBaseClampToEdge` を使う

  ```diff
    @fragment fn fs(fsInput: OurVertexShaderOutput) -> @location(0) vec4f {
  -   return textureSample(ourTexture, ourSampler, fsInput.texcoord);
  +   return textureSampleBaseClampToEdge(
  +     ourTexture,
  +     ourSampler,
  +     fsInput.texcoord,
  +   );
    }
  ```

- `textureSampleBaseClampToEdge` だけでなく `textureLoad` も使える（[脚注3](https://webgpufundamentals.org/webgpu/lessons/ja/webgpu-textures-external-video.html#fn3)）

  <details>
  <summary>補足：<code>textureLoad</code> について</summary>

  - `textureSample` がサンプラー経由で補間しながら読むのに対し、`textureLoad` は整数のテクセル座標で 1 テクセルを直接読む
  - サンプリング・フィルタリングを介さない
  > WGSL 仕様 [§17.7.4 textureLoad](https://www.w3.org/TR/WGSL/#textureload) （"Reads a single texel ... without sampling or filtering"、`coords` は "The 0-based texel coordinate"、`C is i32, or u32`）。

  | | `textureSample` | `textureLoad` |
  |---|---|---|
  | 座標 | 0.0〜1.0 の正規化座標（UV） | 整数のテクセル座標 |
  | サンプラー | 必要 | 不要 |
  | フィルタ / ラップ | サンプラー設定に従う | なし（指定テクセルをそのまま読む） |

  - [ストレージテクスチャ](https://webgpufundamentals.org/webgpu/lessons/ja/webgpu-storage-textures.html)の読み取りに `textureLoad`、書き込みに `textureStore` を使う
  - 主な用途（参考：[WebGPU入門 — Storage Textureを使う](https://zenn.dev/emadurandal/books/cb6818fd3a1b2e/viewer/storage-texture#texture%2C-storage-buffer%2C-storage-texture-%E3%81%AE%E9%81%95%E3%81%84)）
    - コンピュートシェーダーを用いた読み書き
    - 画像処理、ポストプロセス、GPU内でのデータ変換
  - サンプラーで補間すると隣のテクセルと混ざるが、`textureLoad` の場合は座標指定で 1 テクセルずつ読むことができる
  - ものにテクスチャを貼る通常の描画では補間したいので `textureSample` が基本で、`textureLoad` はあまり使わない

  </details>

#### （ iv ） ミップマップが使えない/繰り返し（`repeat`）も無視される

`textureSampleBaseClampToEdge` は名前のとおり、ベース（レベル 0）のミップだけをサンプリングし、エッジにクランプする。

1. **ミップマップを持てない**
    - ミップ用のサンプラー設定（`mipmapFilter`）が不要
    - 組み合わせが 8 通りから 4 通りに減る

    ```diff
    - for (let i = 0; i < 8; ++i) {
    + for (let i = 0; i < 4; ++i) {
        const sampler = device.createSampler({
          addressModeU: 'repeat',
          addressModeV: 'repeat',
          magFilter: (i & 1) ? 'linear' : 'nearest',
          minFilter: (i & 2) ? 'linear' : 'nearest',
    -     mipmapFilter: (i & 4) ? 'linear' : 'nearest',
        });
    ```

2. **`repeat` が無視される**（クランプされる）

  - 繰り返したい場合、自前で `fract` を用いてテクスチャ座標を折り返す。

    ```wgsl
    let color = textureSampleBaseClampToEdge(
      ourTexture,
      ourSampler,
      fract(texcoord),
    );
    ```

これらの制約が用途に合わなければ、前章の `copyExternalImageToTexture` を使う

### 03.  なぜ専用の型・関数が必要なのか？

- `texture_external` と `textureSampleBaseClampToEdge` という専用の型・関数がいる
- そのため、同じ処理でも、静止画（`texture_2d<f32>`）とビデオ（`texture_external`）で別々のシェーダーが必要となる

#### 理由：ビデオは YUV 形式で配信されるが、それを最終的に RGB 形式に変換する必要があるから

- ビデオは輝度（Y、各ピクセルの明るさ）と彩度（UV、色）を分離して配信されることが多い
- 色は輝度より解像度が低いことが多く、この分離（YUV）をすることで圧縮効率が良くなる
  - 人間の目は「色の細かさ」より「明るさの細かさ」に敏感
  - そこで動画は、明るさ(Y)を高解像度で、色(UV)を低解像度で保存し、データ量を減らしている
- 1 枚のビデオテクスチャに見せかけるが、実装上は複数テクスチャ（Y 用、UV 用）に分かれていることがある（ `Y <-> UV` の分離）
- UV もピクセルごとにインターリーブせず、領域を分けて並ぶことがある（ `U <-> V` の分離）

  ```
  // インターリーブではなく…          領域を分けて並ぶことがある
  uvuvuvuv                          uuuuuuuu
  uvuvuvuv            →             uuuuuuuu
  uvuvuvuv                          vvvvvvvv
  uvuvuvuv                          vvvvvvvv
  ```

  このようにデータを配置すると、多くの場合、圧縮が向上する。

- シェーダーに `texture_external` と `textureSampleBaseClampToEdge` を書くと、WebGPU が裏で「この YUV データを読み、複数テクスチャからサンプリングして RGBA に変換する」コードをシェーダーへ挿入する
- 呼び出し側（シェーダコード）から見ると RGBA が返るように見える
- この最適化を WebGPU が肩代わりするのは、これが Web だから
  - ブラウザが対応するビデオ形式は時間とともに変わる
  - YUV → RGB 変換を自分で書くと「形式が変わらない」前提が要るが、Web はそれを保証できない。だから WebGPU 側で吸収する

### 04.  トレードオフ

| | `importExternalTexture` | `copyExternalImageToTexture`（前章） |
|---|---|---|
| コピー | なし（ゼロコピー） | RGBA テクスチャへコピー |
| 速度 | 速い | 変換ぶん遅い |
| 柔軟性 | ビデオ専用シェーダーが要る（`texture_external`） | 静止画と同じシェーダーで扱える |
| ミップ / `repeat` | 不可 | 可 |

- 外部テクスチャの使いどころ：
  - 顔認識での可視化・背景分離など、Meet / Zoom / FB Messenger 的なビデオ機能
  - WebGPU が WebXRでサポートされるようになった場合の VR ビデオ

---

## カメラの使用

- ソースをビデオファイルからカメラに差し替える
- 再生するファイルを指定しない（`muted` / `loop` / `preload` / `src` を外す）。
- クリック時に `getUserMedia` でカメラを要求し、ストリームを `video.srcObject` に入れる。

```diff
  const video = document.createElement('video');
- video.muted = true;
- video.loop = true;
- video.preload = 'auto';
- video.src = 'resources/videos/pexels-anna-bondarenko-5534310 (540p).mp4';
  await waitForClick();
  await startPlayingAndWaitForVideo(video);
```

```diff
  function waitForClick() {
    return new Promise(resolve => {
      window.addEventListener('click',
-       () => {
+       async () => {
          document.querySelector('#start').style.display = 'none';
-         resolve();
+         try {
+           const stream = await navigator.mediaDevices.getUserMedia({ video: true });
+           video.srcObject = stream;
+           resolve();
+         } catch (e) {
+           fail(`could not access camera: ${e.message ?? ''}`);
+         }
        },
        { once: true });
    });
  }
```

- より柔軟な `texture_2d<f32>` としてカメラ画像が欲しい場合は、前章のビデオ例に同じ差し替えを行えばよい
