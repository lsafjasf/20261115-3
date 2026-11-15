/* Color science: sRGB, Machado CVD simulation, CIE Lab / CIEDE2000, WCAG contrast.
 * UMD: works in browser (window.ColorKit) and Node (module.exports). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ColorKit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- sRGB <-> linear ----------
  function srgbToLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function linearToSrgb(c) {
    const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  }

  function hexToRgb(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) {
    const h = (x) => Math.round(x).toString(16).padStart(2, '0');
    return '#' + h(r) + h(g) + h(b);
  }

  // ---------- Machado et al. 2009 CVD matrices (severity 1.0), applied in linear RGB ----------
  const MACHADO = {
    protan: [
      [0.152286, 1.052583, -0.204868],
      [0.114503, 0.786281, 0.099216],
      [-0.003882, -0.048116, 1.051998],
    ],
    deutan: [
      [0.367322, 0.860646, -0.227968],
      [0.280085, 0.672501, 0.047413],
      [-0.01182, 0.04294, 0.968881],
    ],
    tritan: [
      [1.255528, -0.076749, -0.178779],
      [-0.078411, 0.930809, 0.147602],
      [0.004733, 0.691367, 0.3039],
    ],
  };

  // M(s) = I + s * (M(1) - I): s=0 normal vision, s=1 full dichromacy matrix.
  function cvdMatrix(type, severity) {
    const base = MACHADO[type];
    return base.map((row, i) => row.map((m, j) => (i === j ? 1 : 0) + severity * (m - (i === j ? 1 : 0))));
  }

  function matMul(m, v) {
    return [
      m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
      m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
      m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ];
  }

  function simulate(rgb, type, severity) {
    if (type === 'normal') return rgb.slice();
    if (type === 'gray') {
      const y = 0.2126 * srgbToLinear(rgb[0]) + 0.7152 * srgbToLinear(rgb[1]) + 0.0722 * srgbToLinear(rgb[2]);
      const g = linearToSrgb(y);
      return [g, g, g];
    }
    const lin = rgb.map(srgbToLinear);
    const out = matMul(cvdMatrix(type, severity), lin);
    return out.map(linearToSrgb);
  }

  const VIEWS = ['normal', 'protan', 'deutan', 'tritan', 'gray'];
  const VIEW_LABELS = {
    normal: '正常视觉',
    protan: '红色弱视 (P)',
    deutan: '绿色弱视 (D)',
    tritan: '蓝黄弱视 (T)',
    gray: '灰度预览',
  };

  // ---------- CIE XYZ / Lab (D65) ----------
  function rgbToXyz(rgb) {
    const [r, g, b] = rgb.map(srgbToLinear);
    return [
      0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
      0.2126729 * r + 0.7151522 * g + 0.072175 * b,
      0.0193339 * r + 0.119192 * g + 0.9503041 * b,
    ];
  }
  const D65 = [0.95047, 1, 1.08883];
  function labF(t) {
    return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  }
  function rgbToLab(rgb) {
    const [x, y, z] = rgbToXyz(rgb);
    const fx = labF(x / D65[0]);
    const fy = labF(y / D65[1]);
    const fz = labF(z / D65[2]);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  const cosd = (d) => Math.cos((d * Math.PI) / 180);
  const sind = (d) => Math.sin((d * Math.PI) / 180);

  // CIEDE2000 (Sharma et al. implementation)
  function ciede2000(lab1, lab2) {
    const [L1, a1, b1] = lab1;
    const [L2, a2, b2] = lab2;
    const C1 = Math.hypot(a1, b1);
    const C2 = Math.hypot(a2, b2);
    const Cbar = (C1 + C2) / 2;
    const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
    const ap1 = a1 * (1 + G);
    const ap2 = a2 * (1 + G);
    const Cp1 = Math.hypot(ap1, b1);
    const Cp2 = Math.hypot(ap2, b2);
    let hp1 = (Math.atan2(b1, ap1) * 180) / Math.PI;
    if (hp1 < 0) hp1 += 360;
    let hp2 = (Math.atan2(b2, ap2) * 180) / Math.PI;
    if (hp2 < 0) hp2 += 360;
    const dLp = L2 - L1;
    const dCp = Cp2 - Cp1;
    let dhp = 0;
    if (Cp1 * Cp2 !== 0) {
      dhp = hp2 - hp1;
      if (dhp > 180) dhp -= 360;
      else if (dhp < -180) dhp += 360;
    }
    const dHp = 2 * Math.sqrt(Cp1 * Cp2) * sind(dhp / 2);
    const Lbp = (L1 + L2) / 2;
    const Cbp = (Cp1 + Cp2) / 2;
    let hbp = hp1 + hp2;
    if (Cp1 * Cp2 !== 0) {
      hbp = Math.abs(hp1 - hp2) > 180 ? (hp1 + hp2 < 360 ? (hp1 + hp2 + 360) / 2 : (hp1 + hp2 - 360) / 2) : (hp1 + hp2) / 2;
    }
    const T = 1 - 0.17 * cosd(hbp - 30) + 0.24 * cosd(2 * hbp) + 0.32 * cosd(3 * hbp + 6) - 0.2 * cosd(4 * hbp - 63);
    const dtheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
    const RC = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
    const SL = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
    const SC = 1 + 0.045 * Cbp;
    const SH = 1 + 0.015 * Cbp * T;
    const RT = -sind(2 * dtheta) * RC;
    return Math.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH));
  }

  function deltaE(rgb1, rgb2) {
    return ciede2000(rgbToLab(rgb1), rgbToLab(rgb2));
  }

  // WCAG 2.x relative luminance contrast
  function luminance(rgb) {
    const [r, g, b] = rgb.map(srgbToLinear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrastRatio(rgb1, rgb2) {
    const l1 = luminance(rgb1) + 0.05;
    const l2 = luminance(rgb2) + 0.05;
    return Math.max(l1, l2) / Math.min(l1, l2);
  }

  // ---------- HSL candidate generation ----------
  function hslToRgb(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = (p) => {
      const k = (p + h / 30) % 12;
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0) * 255, f(8) * 255, f(4) * 255].map((v) => Math.round(v));
  }

  return {
    srgbToLinear, linearToSrgb, hexToRgb, rgbToHex,
    simulate, cvdMatrix, VIEWS, VIEW_LABELS,
    rgbToLab, ciede2000, deltaE, luminance, contrastRatio, hslToRgb,
  };
});
