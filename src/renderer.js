(function attachFrameRenderer(global) {
  "use strict";

  const W = 960;
  const H = 540;

  function roundRect(ctx, x, y, w, h, radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
  }

  function drawVideoFrame(canvas, state) {
    const ctx = canvas.getContext("2d");
    const frame = Math.max(0, state.renderedFrame);
    const target = Math.max(0, state.targetFrame);
    const phase = frame / global.FrameSync.FPS;
    const hue = (frame * 0.31 + 190) % 360;

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, `hsl(${hue}, 42%, 9%)`);
    bg.addColorStop(0.55, "#07111d");
    bg.addColorStop(1, `hsl(${(hue + 62) % 360}, 50%, 12%)`);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "rgba(117, 226, 255, 0.10)";
    ctx.lineWidth = 1;
    for (let x = 48; x < W; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 45; y < H; y += 45) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    const orbitX = W * 0.62 + Math.sin(phase * 0.85) * 74;
    const orbitY = H * 0.46 + Math.cos(phase * 0.64) * 42;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(86, 223, 255, 0.13)";
    ctx.beginPath();
    ctx.ellipse(W * 0.58, H * 0.48, 238, 128, phase * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    const coreGrad = ctx.createRadialGradient(orbitX, orbitY, 2, orbitX, orbitY, 76);
    coreGrad.addColorStop(0, "rgba(255, 222, 150, 1)");
    coreGrad.addColorStop(0.26, "rgba(255, 163, 74, 0.95)");
    coreGrad.addColorStop(1, "rgba(255, 92, 46, 0)");
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(orbitX, orbitY, 78, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(112, 235, 255, 0.72)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 100; i += 1) {
      const angle = (i / 100) * Math.PI * 2;
      const radius = 150 + Math.sin(angle * 5 + phase * 2.1) * 17;
      const x = W * 0.58 + Math.cos(angle) * radius;
      const y = H * 0.48 + Math.sin(angle) * radius * 0.55;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    const bars = 34;
    for (let i = 0; i < bars; i += 1) {
      const amplitude = 26 + Math.abs(Math.sin(frame * 0.07 + i * 0.8)) * 106;
      const x = 62 + i * 7.4;
      ctx.fillStyle = i % 4 === 0 ? "rgba(255, 182, 72, 0.72)" : "rgba(86, 220, 255, 0.42)";
      ctx.fillRect(x, H - 56 - amplitude, 3, amplitude);
    }

    ctx.fillStyle = "rgba(4, 12, 22, 0.76)";
    roundRect(ctx, 34, 30, 360, 92, 12);
    ctx.fill();
    ctx.strokeStyle = "rgba(120, 220, 255, 0.26)";
    ctx.stroke();

    ctx.fillStyle = "#7de7ff";
    ctx.font = "600 14px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText("SYNTHETIC VIDEO // 30 FPS", 54, 57);
    ctx.fillStyle = "#f5fbff";
    ctx.font = "700 38px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(`FRAME ${String(frame).padStart(4, "0")}`, 52, 98);

    ctx.fillStyle = "rgba(7, 18, 31, 0.78)";
    roundRect(ctx, W - 242, 30, 208, 70, 12);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 183, 79, 0.28)";
    ctx.stroke();
    ctx.fillStyle = "#ffbf66";
    ctx.font = "600 13px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(`TC ${state.targetTime.toFixed(3)}s`, W - 222, 56);
    ctx.fillStyle = "#9aacc2";
    ctx.font = "500 12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(`${state.cue.id} / PTS ${frame}`, W - 222, 80);

    ctx.fillStyle = "rgba(233, 247, 255, 0.78)";
    ctx.font = "500 12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(`REQUEST #${state.requestSeq}`, 42, 496);
    ctx.fillText(`AUDIO ${state.audioTime.toFixed(3)}s`, 42, 515);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.beginPath();
    ctx.moveTo(0, H - 7);
    ctx.lineTo(W, H - 7);
    ctx.stroke();

    if (state.pending) {
      ctx.fillStyle = "rgba(4, 10, 18, 0.58)";
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.fillStyle = "#8eeaff";
      ctx.font = "600 18px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText(`SEEKING → FRAME ${String(target).padStart(4, "0")}`, W / 2, H / 2);
      ctx.fillStyle = "rgba(142, 234, 255, 0.34)";
      ctx.fillRect(W / 2 - 110, H / 2 + 20, 220, 2);
      ctx.fillStyle = "#ffb447";
      ctx.fillRect(W / 2 - 110, H / 2 + 19, 220 * ((Date.now() / 8) % 220) / 220, 3);
      ctx.textAlign = "left";
    }
  }

  function drawAudioScope(canvas, state) {
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, "#0d2333");
    gradient.addColorStop(1, "#101a28");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const seconds = Math.max(0, state.audioTime);
    ctx.strokeStyle = "#35cdec";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x < width; x += 2) {
      const t = (x / width) * 8 + seconds;
      const attack = 10 + Math.sin(t * 8.1) * 6 + Math.sin(t * 21.7) * 3;
      const envelope = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.85));
      const y = height / 2 + attack * envelope;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 184, 78, 0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(width - 2, 0);
    ctx.lineTo(width - 2, height);
    ctx.stroke();
    ctx.fillStyle = "rgba(6, 16, 26, 0.74)";
    ctx.fillRect(0, 0, 126, 20);
    ctx.fillStyle = "#8fbdd0";
    ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(`AUD ${state.audioTime.toFixed(3)}s`, 9, 14);
  }

  global.FrameRender = { drawVideoFrame, drawAudioScope, W, H };
})(typeof globalThis !== "undefined" ? globalThis : window);
