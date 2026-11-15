# 双轨音频相位对齐工作台

把两段**同一合成源、不同延迟**的音频对齐。提供两种使用方式：

- **网页工作台**（`web/`）：拖动波形上的相位标记，实时显示声道相关值与抵消深度，可直接试听求和（变厚）/ 差值（变薄），并在浏览器内保存延迟值、导出混音 WAV。
- **Node 命令行**（`tools/`）：零依赖，用自研 FFT 完成互相关与自动对齐，生成 WAV 与 JSON 报告。

## 目录结构

```
align-audio/
├── package.json
├── README.md
├── tools/
│   ├── dsp.js          # FFT、互相关、Pearson 相关、抵消深度、自动估延迟
│   ├── wav.js          # PCM16 WAV 读写
│   ├── generate.js     # 生成同一合成源的两个延迟取声
│   ├── align.js        # 命令行自动对齐 + 导出混音 WAV
│   ├── serve.js        # 网页静态服务器
│   └── test.js         # DSP 单元测试（7 项）
├── web/
│   ├── index.html
│   ├── style.css
│   ├── dsp-browser.js      # 浏览器版 FFT/互相关
│   ├── metrics-browser.js  # 浏览器版指标、估延迟、WAV 编解码
│   ├── state.js            # 状态、内置示例、载入、导出
│   ├── app.js              # 波形与相关曲线渲染
│   └── interaction.js      # 拖拽、微调、试听、事件绑定
└── output/             # 生成的音频与报告
```

## 快速开始

```bash
npm test                 # 运行 DSP 单元测试
npm run generate         # 生成 take_a.wav / take_b.wav（B 延迟 317 采样）
npm run align            # 自动对齐，导出混音并写 alignment_result.json
npm run serve            # 打开 http://localhost:8791 使用网页工作台
```

也可指定任意两个 PCM16 WAV：

```bash
node tools/align.js --a path/a.wav --b path/b.wav --max-ms 50 --polarity auto
```

`--polarity` 可选 `auto`（默认，自动识别反相）、`normal`、`invert`。

## 网页工作台操作

1. 点“载入内置示例”，或分别选择 A / B 两个 WAV（16-bit PCM）。
2. 在波形区**横向拖动**黄色相位标记，或用滑块 / ±1、±10 按钮 / 鼠标滚轮逐采样微调；双击复位到 0。
3. 实时观察：
   - **声道相关值 ρ**：对齐时趋近 +1（反相时为 −1，可勾选“B 反相”）。
   - **抵消深度**：`20·log10(RMS(A) / RMS(A−B))`，对齐越好差值越安静、数值越大。
   - **求和/差值峰值**：求和峰变大（声音变厚），差值峰变小（抵消变薄）。
4. 用“播放求和 A+B / 差值 A−B”在微调时直接听厚薄变化。
5. 点“自动估计延迟”得到 FFT 归一化互相关峰（图中绿点）。
6. 点“保存延迟并导出混音 WAV”，浏览器下载 `aligned_sum.wav` 与 `aligned_stereo.wav`。

## 指标定义

- 滞后约定：`lag > 0` 表示 **B 相对 A 延迟** `lag` 个采样，配对 `a[i] ↔ b[i+lag]`。
- 声道相关值：重叠区去均值后的 Pearson 相关系数，范围 [−1, 1]。
- 抵消深度（dB）：`20·log10(RMS(A) / RMS(A−B))`，正值表示差值被压低。
- 自动估延迟：FFT 加速的归一化互相关，在 `±max-ms` 窗口内取绝对最大峰，并据此判断极性。

## 本次实测对齐结果（48 kHz，B 真值延迟 317 采样 = 6.6042 ms）

| 指标 | 对齐前 (lag=0) | 对齐后 (lag=317) |
|---|---|---|
| 估计延迟 | — | 317 采样 / 6.6042 ms（与真值一致） |
| 声道相关值 ρ | −0.530334 | 1.000000 |
| 求和峰值 peakSum | 0.903015 | 1.730255（约 1.92×，明显变厚） |
| 差值峰值 peakDiff | 1.360107 | 0.069672（缩小约 19.5×） |
| 抵消深度 | −4.52 dB | +22.22 dB |

导出文件（`output/`）：

- `aligned_sum.wav`：对齐后单声道求和混音（归一化到 −0.45 dBFS 左右）。
- `aligned_diff.wav`：对齐后差值，用来听抵消效果（只剩噪声底）。
- `aligned_stereo.wav`：对齐后的 A/B 双声道，便于在 DAW 里核对相位。
- `alignment_result.json`：保存的延迟值、极性与对齐前后全部指标。
