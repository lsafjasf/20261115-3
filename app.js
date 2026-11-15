/* app.js — UI  wiring：参数、刷子（环绕同步）、预览、导出 */
'use strict';
(function () {
  const PREVIEW = 512;
  const MOD_SIZE = 1024; // 刷子层固定分辨率，导出时周期重采样

  const params = TexGen.defaultParams();

  // 刷子层：R=＋苔藓, G=－苔藓, B=明暗(128 中性)
  const modData = new Uint8ClampedArray(MOD_SIZE * MOD_SIZE * 4);
  for (let i = 0; i < MOD_SIZE * MOD_SIZE; i++) modData[i * 4 + 2] = 128;
  const mod = { data: modData, width: MOD_SIZE, height: MOD_SIZE };

  const view = document.getElementById('view');
  const viewCtx = view.getContext('2d');
  const tiled = document.getElementById('tiled');
  const tiledCtx = tiled.getContext('2d');
  const status = document.getElementById('status');

  // ---------- 参数绑定 ----------
  function bindRange(id, get, set) {
    const el = document.getElementById(id);
    const val = el.parentElement.querySelector('.val');
    const show = () => { if (val) val.textContent = el.value; };
    el.addEventListener('input', () => { set(parseFloat(el.value)); show(); scheduleRender(); });
    show();
  }
  function bindColor(id, set) {
    const el = document.getElementById(id);
    el.addEventListener('input', () => { set(el.value); scheduleRender(); });
  }

  bindRange('stoneScale', null, v => params.stone.scale = v);
  bindRange('grainAngle', null, v => params.stone.grainAngle = v);
  bindRange('grainLength', null, v => params.stone.grainLength = v);
  bindRange('contrast', null, v => params.stone.contrast = v);
  bindColor('colorDark', v => params.stone.colorDark = v);
  bindColor('colorLight', v => params.stone.colorLight = v);
  bindRange('cells', null, v => params.cracks.cells = v);
  bindRange('crackWidth', null, v => params.cracks.width = v);
  bindRange('walkCount', null, v => params.cracks.walkCount = v);
  bindRange('walkAngle', null, v => params.cracks.walkAngle = v);
  bindRange('walkSpread', null, v => params.cracks.walkSpread = v);
  bindRange('walkWidth', null, v => params.cracks.walkWidth = v);
  bindRange('crackIntensity', null, v => params.cracks.intensity = v);
  bindRange('mossCoverage', null, v => params.moss.coverage = v);
  bindRange('mossScale', null, v => params.moss.scale = v);
  bindColor('mossColor', v => params.moss.color = v);

  const seedInput = document.getElementById('seed');
  seedInput.addEventListener('input', () => {
    params.seed = parseInt(seedInput.value, 10) || 0;
    scheduleRender();
  });
  document.getElementById('randSeed').addEventListener('click', () => {
    params.seed = Math.floor(Math.random() * 1e9);
    seedInput.value = params.seed;
    scheduleRender();
  });
  // ---------- 渲染 ----------
  let renderTimer = null;
  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(renderPreview, 120);
  }

  function renderPreview() {
    const t0 = performance.now();
    const img = TexGen.render(params, PREVIEW, mod);
    viewCtx.putImageData(new ImageData(img.data, PREVIEW, PREVIEW), 0, 0);

    // 2×2 平铺预览：直接复制像素，接缝若存在会一目了然
    const half = PREVIEW / 2;
    tiledCtx.imageSmoothingEnabled = false;
    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 0; tx < 2; tx++) {
        tiledCtx.drawImage(view, tx * half, ty * half, half, half);
      }
    }

    const seam = TexGen.seamError(img);
    status.textContent =
      `渲染 ${(performance.now() - t0).toFixed(0)}ms · ` +
      `跨边界差 max=${seam.max} mean=${seam.mean.toFixed(2)}（0 附近即环绕连续）`;
  }

  // ---------- 刷子（环绕落笔 -> 自动同步到对边） ----------
  let tool = 'mossAdd';
  const toolBar = document.getElementById('tools');
  toolBar.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    tool = btn.dataset.tool;
    toolBar.querySelectorAll('button').forEach(b =>
      b.classList.toggle('active', b === btn));
  });
  toolBar.querySelector('button').classList.add('active');

  let brushSize = 28, brushStrength = 0.4;
  document.getElementById('brushSize').addEventListener('input', e => {
    brushSize = parseFloat(e.target.value);
    e.target.parentElement.querySelector('.val').textContent = e.target.value;
  });
  document.getElementById('brushStrength').addEventListener('input', e => {
    brushStrength = parseFloat(e.target.value);
    e.target.parentElement.querySelector('.val').textContent = e.target.value;
  });

  // 在 MOD_SIZE 刷子层上环绕盖章：坐标取模，越过边缘的笔迹绕回到对边
  function stampMod(tx, ty) {
    const r = brushSize * (MOD_SIZE / PREVIEW) / 2;
    const cx = tx * MOD_SIZE, cy = ty * MOD_SIZE;
    const ri = Math.ceil(r);
    for (let dy = -ri; dy <= ri; dy++) {
      for (let dx = -ri; dx <= ri; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r * r) continue;
        const px = ((Math.round(cx) + dx) % MOD_SIZE + MOD_SIZE) % MOD_SIZE;
        const py = ((Math.round(cy) + dy) % MOD_SIZE + MOD_SIZE) % MOD_SIZE;
        const idx = (py * MOD_SIZE + px) * 4;
        const f = brushStrength * (1 - Math.sqrt(d2) / (r + 1e-6));
        if (tool === 'mossAdd') {
          modData[idx] = Math.min(255, modData[idx] + f * 90);
        } else if (tool === 'mossRemove') {
          modData[idx + 1] = Math.min(255, modData[idx + 1] + f * 90);
        } else if (tool === 'darken') {
          modData[idx + 2] = Math.max(0, modData[idx + 2] - f * 40);
        } else if (tool === 'lighten') {
          modData[idx + 2] = Math.min(255, modData[idx + 2] + f * 40);
        }
      }
    }
  }

  let painting = false;
  function paintAt(e) {
    const rect = view.getBoundingClientRect();
    const tx = (e.clientX - rect.left) / rect.width;
    const ty = (e.clientY - rect.top) / rect.height;
    stampMod(tx, ty);
    scheduleRender();
  }
  view.addEventListener('pointerdown', e => {
    painting = true;
    view.setPointerCapture(e.pointerId);
    paintAt(e);
  });
  view.addEventListener('pointermove', e => { if (painting) paintAt(e); });
  view.addEventListener('pointerup', () => { painting = false; });

  document.getElementById('clearBrush').addEventListener('click', () => {
    for (let i = 0; i < MOD_SIZE * MOD_SIZE; i++) {
      modData[i * 4] = 0; modData[i * 4 + 1] = 0; modData[i * 4 + 2] = 128;
    }
    scheduleRender();
  });

  // ---------- 导出 ----------
  function exportPng(size) {
    status.textContent = `正在渲染 ${size}×${size} …`;
    setTimeout(() => {
      const img = TexGen.render(params, size, mod);
      const c = document.createElement('canvas');
      c.width = c.height = size;
      c.getContext('2d').putImageData(new ImageData(img.data, size, size), 0, 0);
      c.toBlob(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `texture_${size}_seed${params.seed}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
        status.textContent = `已导出 ${a.download}`;
      }, 'image/png');
    }, 30);
  }
  document.getElementById('export512').addEventListener('click', () => exportPng(512));
  document.getElementById('export1024').addEventListener('click', () => exportPng(1024));

  renderPreview();
})();
