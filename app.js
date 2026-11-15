/* UI orchestration: two palettes, locking, live metrics, danger blocking,
 * canvas CVD/gray previews, and lock-consistency verification. */
(function () {
  'use strict';
  const C = window.ColorKit;
  const G = window.PaletteGen;
  const COUNT = 6;

  const settings = { severity: 1, minContrast: 1.15, minDeltaE: 7 };
  const palettes = [
    { id: 0, title: '配色方案 A', seed: 7, colors: [], locked: new Array(COUNT).fill(false) },
    { id: 1, title: '配色方案 B', seed: 42, colors: [], locked: new Array(COUNT).fill(false) },
  ];

  const $ = (id) => document.getElementById(id);
  const simHex = (hex, view) => C.rgbToHex(...C.simulate(C.hexToRgb(hex), view, settings.severity));

  function lockedHexes(p) {
    return p.colors.map((hex, i) => (p.locked[i] ? hex : null));
  }

  function regenerate(p, seed) {
    const result = G.generatePalette({
      count: COUNT,
      seed: seed == null ? Math.floor(Math.random() * 1e9) : seed,
      locked: lockedHexes(p),
      severity: settings.severity,
      minContrast: settings.minContrast,
      minDeltaE: settings.minDeltaE,
    });
    p.colors = result.colors;
    p.lastReport = result.report;
    return result;
  }

  function initialGenerate() {
    palettes.forEach((p) => regenerate(p, p.seed));
  }

  function metricClass(value, threshold) {
    return value >= threshold ? 'good' : 'bad';
  }

  function render() {
    const container = $('palette-container');
    container.innerHTML = '';
    palettes.forEach((p) => container.appendChild(renderPalette(p)));
  }

  function renderPalette(p) {
    const report = G.evaluatePalette(p.colors, settings.severity, {
      minContrast: settings.minContrast,
      minDeltaE: settings.minDeltaE,
    });
    p.lastReport = report;
    const card = document.createElement('section');
    card.className = 'palette-card';

    const head = document.createElement('h2');
    head.innerHTML = `${p.title}
      <span class="badge ${report.passed ? 'pass' : 'fail'}">${report.passed ? '全部视图安全' : '存在危险组合'}</span>`;
    const regenBtn = document.createElement('button');
    regenBtn.className = 'regen';
    regenBtn.textContent = '重新生成（保留锁定）';
    regenBtn.onclick = () => { regenerate(p); render(); };
    head.appendChild(regenBtn);
    card.appendChild(head);

    const status = document.createElement('div');
    status.className = 'status-line';
    const lockedCount = p.locked.filter(Boolean).length;
    status.textContent = `已锁定 ${lockedCount} 个关键色 · 阈值：对比度 ≥ ${settings.minContrast}，ΔE ≥ ${settings.minDeltaE}，弱视严重度 ${settings.severity.toFixed(2)}`;
    card.appendChild(status);

    const swatches = document.createElement('div');
    swatches.className = 'swatches';
    p.colors.forEach((hex, i) => swatches.appendChild(renderSwatch(p, i, report)));
    card.appendChild(swatches);

    card.appendChild(renderMetrics(p, report));
    card.appendChild(renderViews(p));
    return card;
  }

  function swatchConflicts(p, index) {
    const others = p.colors.filter((_, i) => i !== index);
    const check = G.checkColor(p.colors[index], others, settings.severity,
      settings.minContrast, settings.minDeltaE);
    check.conflicts.forEach((c) => {
      c.paletteIndex = c.index >= index ? c.index + 1 : c.index;
    });
    return check;
  }

  function renderSwatch(p, i, report) {
    const hex = p.colors[i];
    const wrap = document.createElement('div');
    wrap.className = 'swatch' + (p.locked[i] ? ' locked' : '');

    const row = document.createElement('div');
    row.className = 'swatch-row';
    const chip = document.createElement('span');
    chip.className = 'color-chip';
    chip.style.background = hex;
    row.appendChild(chip);

    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = hex;
    picker.title = '手动选色（危险组合会被拦截）';
    picker.disabled = p.locked[i];
    picker.oninput = () => applyManualColor(p, i, picker.value, wrap);
    row.appendChild(picker);

    const hexLabel = document.createElement('span');
    hexLabel.className = 'hex';
    hexLabel.textContent = hex.toUpperCase();
    row.appendChild(hexLabel);
    wrap.appendChild(row);

    const lockBtn = document.createElement('button');
    lockBtn.textContent = p.locked[i] ? '解锁' : '锁定';
    lockBtn.onclick = () => { p.locked[i] = !p.locked[i]; render(); };
    wrap.appendChild(lockBtn);

    const note = document.createElement('div');
    const check = swatchConflicts(p, i);
    if (check.safe) {
      note.className = 'ok';
      note.textContent = '与其余颜色在所有视图可辨识';
    } else {
      wrap.classList.add('unsafe');
      note.className = 'warn';
      const c = check.conflicts[0];
      note.textContent = `危险：与色 ${p.colors[c.paletteIndex].toUpperCase()} 在「${C.VIEW_LABELS[c.view]}」下冲突（对比度 ${c.contrast.toFixed(2)}，ΔE ${c.deltaE.toFixed(1)}）`;
    }
    wrap.appendChild(note);
    return wrap;
  }

  // Manual color picking: block dangerous choices, revert and explain.
  function applyManualColor(p, i, hex, wrapEl) {
    const others = p.colors.filter((_, j) => j !== i);
    const check = G.checkColor(hex, others, settings.severity,
      settings.minContrast, settings.minDeltaE);
    if (!check.safe) {
      wrapEl.classList.add('unsafe');
      flashBlocked(wrapEl);
      render();
      alert(`已阻止该颜色：在某视图下与现有颜色的对比度或色差低于阈值（最低对比度 ${check.worstContrast.toFixed(2)}，最低 ΔE ${check.worstDeltaE.toFixed(1)}）。请调整阈值或选择其他颜色。`);
      return;
    }
    p.colors[i] = hex;
    render();
  }

  function flashBlocked(el) {
    el.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' },
       { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }],
      { duration: 220, iterations: 2 }
    );
  }

  function renderMetrics(p, report) {
    const box = document.createElement('div');
    box.className = 'metrics';
    C.VIEWS.forEach((view) => {
      const v = report.views[view];
      const m = document.createElement('div');
      m.className = 'metric';
      const cOk = v.minContrast >= settings.minContrast;
      const eOk = v.minDeltaE >= settings.minDeltaE;
      m.innerHTML = `<div class="view-name">${C.VIEW_LABELS[view]}</div>
        <div class="values">
          <span class="${metricClass(v.minContrast, settings.minContrast)}">对比度 ${v.minContrast.toFixed(2)}</span>
          <span class="${metricClass(v.minDeltaE, settings.minDeltaE)}">ΔE ${v.minDeltaE.toFixed(1)}</span>
        </div>`;
      if (!cOk || !eOk) m.style.borderColor = '#ef4444';
      box.appendChild(m);
    });
    return box;
  }

  function renderViews(p) {
    const row = document.createElement('div');
    row.className = 'views';
    C.VIEWS.forEach((view) => {
      const box = document.createElement('div');
      box.className = 'view-box';
      const cap = document.createElement('div');
      cap.className = 'cap';
      cap.textContent = C.VIEW_LABELS[view];
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 150;
      box.appendChild(cap);
      box.appendChild(canvas);
      row.appendChild(box);
      requestAnimationFrame(() => drawChart(canvas, p.colors, view));
    });
    return row;
  }

  // Draw a sample grouped-bar + line chart on a canvas under a given view.
  function drawChart(canvas, hexes, view) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    const sim = hexes.map((h) => C.rgbToHex(...C.simulate(C.hexToRgb(h), view, settings.severity)));

    const padL = 34, padB = 30, padT = 12, padR = 10;
    const plotW = W - padL - padR, plotH = H - padB - padT;
    ctx.strokeStyle = '#d9d9d9';
    ctx.fillStyle = '#555';
    ctx.font = '10px sans-serif';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const y = padT + (plotH * g) / 4;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillText(String(100 - g * 25), 6, y + 3);
    }

    const groups = 3;
    const groupW = plotW / groups;
    const barW = (groupW - 18) / sim.length;
    for (let grp = 0; grp < groups; grp++) {
      const gx = padL + grp * groupW + 8;
      sim.forEach((color, k) => {
        const value = 28 + ((k * 37 + grp * 23 + 15) % 62);
        const bh = (value / 100) * plotH;
        ctx.fillStyle = color;
        ctx.fillRect(gx + k * barW, padT + plotH - bh, barW - 2, bh);
      });
      ctx.fillStyle = '#555';
      ctx.fillText('组' + (grp + 1), gx + groupW / 2 - 12, H - 12);
    }

    // Overlaid line using the last palette color to exercise line distinguishability.
    ctx.strokeStyle = sim[sim.length - 1];
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let grp = 0; grp < groups; grp++) {
      const x = padL + grp * groupW + groupW / 2;
      const value = 55 + ((grp * 19 + 11) % 30);
      const y = padT + plotH - (value / 100) * plotH;
      grp === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Legend chips with simulated swatches.
    ctx.font = '8px sans-serif';
    sim.forEach((color, k) => {
      const x = padL + k * ((plotW) / sim.length);
      ctx.fillStyle = color;
      ctx.fillRect(x, H - 24, 9, 9);
      ctx.fillStyle = '#444';
      ctx.fillText('C' + (k + 1), x + 11, H - 16);
    });
  }

  // Verification: lock colors, regenerate, confirm locked source hex stays
  // identical and every view's simulated rendering is unchanged.
  function runVerification() {
    const lines = [];
    let allOk = true;
    palettes.forEach((p, pi) => {
      const before = p.colors.slice();
      const lockIdx = [0, 3];
      const locked = new Array(COUNT).fill(null);
      lockIdx.forEach((idx) => { locked[idx] = before[idx]; });
      const result = G.generatePalette({
        count: COUNT, seed: p.seed + 500, locked,
        severity: settings.severity,
        minContrast: settings.minContrast, minDeltaE: settings.minDeltaE,
      });
      const after = result.colors;
      lines.push(`【${p.title}】锁定槽位 ${lockIdx.map((x) => 'C' + (x + 1)).join('、')}`);
      lockIdx.forEach((idx) => {
        const sourceSame = after[idx] === before[idx];
        let viewsSame = true;
        const perView = C.VIEWS.map((v) => {
          const a = simHex(before[idx], v);
          const b = simHex(after[idx], v);
          if (a !== b) viewsSame = false;
          return `${C.VIEW_LABELS[v]}:${a}`;
        });
        const ok = sourceSame && viewsSame;
        allOk = allOk && ok;
        lines.push(`  ${ok ? '✓' : '✗'} C${idx + 1} ${before[idx].toUpperCase()} 源色${sourceSame ? '未变' : '改变!'}; 各视图模拟色 ${viewsSame ? '完全一致' : '不一致!'}`);
        lines.push(`      ${perView.join('  ')}`);
      });
      const unlockedChanged = after.some((h, i) => !lockIdx.includes(i) && h !== before[i]);
      lines.push(`  非锁定色已重新生成：${unlockedChanged ? '是' : '否'}；新盘安全：${result.passed ? '是' : '否'}`);
      lines.push('');
    });
    lines.unshift(allOk ? '✔ 验证通过：所有锁定色在正常、红色弱视、绿色弱视、蓝黄弱视、灰度五个视图中均保持不变。\n'
      : '✘ 验证失败：存在锁定色变化。\n');
    const out = $('verify-output');
    out.textContent = lines.join('\n');
    out.className = allOk ? 'ok-text' : 'err-text';
    return allOk;
  }

  function bindControls() {
    const bindRange = (id, outId, key, parse) => {
      $(id).addEventListener('input', (e) => {
        settings[key] = parse(e.target.value);
        $(outId).textContent = key === 'severity' ? settings[key].toFixed(2) : settings[key];
        render();
      });
    };
    bindRange('severity', 'severity-val', 'severity', parseFloat);
    bindRange('min-contrast', 'contrast-val', 'minContrast', parseFloat);
    bindRange('min-deltae', 'deltae-val', 'minDeltaE', parseFloat);
    $('regen-all').onclick = () => { palettes.forEach((p) => regenerate(p)); render(); };
    $('run-verify').onclick = runVerification;
  }

  window.__cb = {
    regenerate, render, runVerification, settings, palettes, COUNT,
    simHex, lockedHexes, swatchConflicts, applyManualColor,
  };

  initialGenerate();
  bindControls();
  render();
  // Auto-run the verification once on load so results are visible immediately.
  runVerification();
})();
