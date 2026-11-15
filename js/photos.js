// 程序化生成三张“照片”，全部用 Canvas 绘制，不加载任何外部图片。

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// 简易可复现随机数
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function photoSunset() {
  const c = makeCanvas(800, 600);
  const ctx = c.getContext("2d");
  const sky = ctx.createLinearGradient(0, 0, 0, 600);
  sky.addColorStop(0, "#2b1a4e");
  sky.addColorStop(0.45, "#a63d63");
  sky.addColorStop(0.75, "#f2814f");
  sky.addColorStop(1, "#ffd98a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 800, 600);

  const sun = ctx.createRadialGradient(400, 380, 10, 400, 380, 160);
  sun.addColorStop(0, "rgba(255,240,200,1)");
  sun.addColorStop(0.4, "rgba(255,190,110,0.9)");
  sun.addColorStop(1, "rgba(255,160,80,0)");
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(400, 380, 160, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffe9b8";
  ctx.beginPath();
  ctx.arc(400, 380, 70, 0, Math.PI * 2);
  ctx.fill();

  const ridges = [
    ["#5a2a52", 430, 90],
    ["#3c1c40", 490, 70],
    ["#241028", 550, 50],
  ];
  for (const [color, base, amp] of ridges) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 600);
    for (let x = 0; x <= 800; x += 40) {
      ctx.lineTo(x, base - Math.abs(Math.sin(x * 0.011 + base)) * amp);
    }
    ctx.lineTo(800, 600);
    ctx.closePath();
    ctx.fill();
  }
  return c;
}

function photoGeometry() {
  const c = makeCanvas(800, 600);
  const ctx = c.getContext("2d");
  const rand = rng(20261115);
  const bg = ctx.createLinearGradient(0, 0, 800, 600);
  bg.addColorStop(0, "#0f3d4c");
  bg.addColorStop(1, "#123c2a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 800, 600);

  const palette = ["#ffd166", "#ef476f", "#06d6a0", "#118ab2", "#f8f7ff"];
  for (let i = 0; i < 46; i++) {
    const x = rand() * 800;
    const y = rand() * 600;
    const r = 18 + rand() * 70;
    ctx.globalAlpha = 0.25 + rand() * 0.55;
    ctx.fillStyle = palette[Math.floor(rand() * palette.length)];
    if (rand() < 0.5) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rand() * Math.PI);
      ctx.fillRect(-r, -r * 0.6, r * 2, r * 1.2);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
  return c;
}

function photoNight() {
  const c = makeCanvas(800, 600);
  const ctx = c.getContext("2d");
  const rand = rng(515);
  const sky = ctx.createLinearGradient(0, 0, 0, 600);
  sky.addColorStop(0, "#050914");
  sky.addColorStop(0.7, "#0d1b3d");
  sky.addColorStop(1, "#1b2f5e");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 800, 600);

  for (let i = 0; i < 260; i++) {
    const x = rand() * 800;
    const y = rand() * 480;
    const r = rand() * 1.6 + 0.3;
    ctx.globalAlpha = 0.3 + rand() * 0.7;
    ctx.fillStyle = rand() < 0.15 ? "#cfe4ff" : "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const moon = ctx.createRadialGradient(620, 140, 8, 620, 140, 90);
  moon.addColorStop(0, "rgba(240,244,255,1)");
  moon.addColorStop(0.5, "rgba(200,214,245,0.85)");
  moon.addColorStop(1, "rgba(180,200,240,0)");
  ctx.fillStyle = moon;
  ctx.beginPath();
  ctx.arc(620, 140, 90, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e8edfb";
  ctx.beginPath();
  ctx.arc(620, 140, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(160,175,210,0.5)";
  for (const [cx, cy, cr] of [[605, 128, 9], [638, 150, 6], [615, 158, 5]]) {
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#060a18";
  ctx.beginPath();
  ctx.moveTo(0, 600);
  for (let x = 0; x <= 800; x += 50) {
    ctx.lineTo(x, 520 - Math.abs(Math.sin(x * 0.02 + 2)) * 60);
  }
  ctx.lineTo(800, 600);
  ctx.closePath();
  ctx.fill();
  return c;
}

// 返回 [{ id, name, canvas, dataURL, width, height }]
export function generatePhotos() {
  const defs = [
    { id: "sunset", name: "暮色山峦", make: photoSunset },
    { id: "geometry", name: "几何律动", make: photoGeometry },
    { id: "night", name: "星夜月升", make: photoNight },
  ];
  return defs.map((d) => {
    const canvas = d.make();
    return {
      id: d.id,
      name: d.name,
      canvas,
      dataURL: canvas.toDataURL("image/png"),
      width: canvas.width,
      height: canvas.height,
    };
  });
}
