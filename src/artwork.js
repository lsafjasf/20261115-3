function gradient(ctx, w, h, stops, vertical = true) {
  const fill = vertical
    ? ctx.createLinearGradient(0, 0, 0, h)
    : ctx.createLinearGradient(0, 0, w, 0)
  stops.forEach(([at, color]) => fill.addColorStop(at, color))
  return fill
}

function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color
  ctx.fillRect(x, y, w, h)
}

function circle(ctx, x, y, r, color) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

function line(ctx, x1, y1, x2, y2, color, width = 1) {
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

function glow(ctx, x, y, radius, color) {
  const halo = ctx.createRadialGradient(x, y, 0, x, y, radius)
  halo.addColorStop(0, color)
  halo.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = halo
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
}

function rain(ctx, w, h, color = 'rgba(210,236,229,.38)') {
  for (let i = 0; i < 52; i += 1) {
    const x = ((i * 97) % 101) / 101 * w
    const y = ((i * 43) % 97) / 97 * h
    const length = h * (0.018 + (i % 5) * 0.006)
    line(ctx, x, y, x - length * 0.28, y + length, color, Math.max(0.6, w / 900))
  }
}

function cityBlocks(ctx, w, h, baseY) {
  const blocks = [
    [0, 0.13, 0.21], [0.12, 0.2, 0.31], [0.3, 0.12, 0.24],
    [0.4, 0.24, 0.17], [0.62, 0.15, 0.28], [0.74, 0.23, 0.21],
    [0.94, 0.18, 0.3],
  ]
  blocks.forEach(([x, width, top], index) => {
    const bx = x * w
    const bw = width * w
    const by = top * h
    rect(ctx, bx, by, bw, baseY - by, index % 2 ? '#132e33' : '#16373a')
    for (let wy = by + h * 0.04; wy < baseY - h * 0.04; wy += h * 0.055) {
      for (let wx = bx + w * 0.018; wx < bx + bw - w * 0.012; wx += w * 0.033) {
        const lit = (Math.floor(wx + wy) % 5) < 2
        if (lit) rect(ctx, wx, wy, w * 0.009, h * 0.012, index % 3 ? '#c79658' : '#6fa19a')
      }
    }
  })
}

function rider(ctx, x, y, scale, color = '#151c1d', facing = 1) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(scale * facing, scale)
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 4.5
  ctx.beginPath()
  ctx.arc(-48, 24, 25, 0, Math.PI * 2)
  ctx.arc(42, 24, 25, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(-48, 24)
  ctx.lineTo(-9, -8)
  ctx.lineTo(17, 24)
  ctx.lineTo(-48, 24)
  ctx.moveTo(-9, -8)
  ctx.lineTo(42, 24)
  ctx.moveTo(17, 24)
  ctx.lineTo(12, -20)
  ctx.stroke()
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.moveTo(-8, -14)
  ctx.lineTo(5, -56)
  ctx.lineTo(22, -48)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(-9, -6)
  ctx.lineTo(8, 5)
  ctx.stroke()
  circle(ctx, 12, -76, 11, color)
  ctx.beginPath()
  ctx.moveTo(-8, -58)
  ctx.lineTo(24, -62)
  ctx.lineTo(27, -39)
  ctx.lineTo(-4, -35)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = 'rgba(223,104,67,.95)'
  ctx.fillRect(25, -68, 27, 31)
  ctx.strokeStyle = 'rgba(245,200,130,.7)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(51, -62)
  ctx.lineTo(67, -58)
  ctx.lineTo(64, -35)
  ctx.lineTo(51, -38)
  ctx.stroke()
  ctx.restore()
}

function drawStreet(ctx, w, h) {
  ctx.fillStyle = gradient(ctx, w, h, [[0, '#0b252b'], [0.55, '#164047'], [1, '#0c2529']])
  ctx.fillRect(0, 0, w, h)
  glow(ctx, w * 0.72, h * 0.15, w * 0.28, 'rgba(226,95,80,.18)')
  glow(ctx, w * 0.09, h * 0.33, w * 0.22, 'rgba(45,176,156,.18)')
  cityBlocks(ctx, w, h, h * 0.63)
  rect(ctx, 0, h * 0.61, w, h * 0.39, '#102f34')
  rect(ctx, 0, h * 0.62, w, h * 0.015, 'rgba(133,205,188,.22)')

  ctx.save()
  ctx.transform(1, 0, -0.45, 0.33, w * 0.46, h * 0.63)
  for (let i = 0; i < 11; i += 1) {
    rect(ctx, i * w * 0.105, 0, w * 0.006, h * 0.48, 'rgba(174,211,198,.15)')
  }
  ctx.restore()

  ctx.fillStyle = '#c94f3e'
  ctx.fillRect(w * 0.05, h * 0.19, w * 0.036, h * 0.16)
  ctx.fillStyle = '#f0b66a'
  ctx.font = `700 ${Math.max(7, w * 0.022)}px monospace`
  ctx.fillText('夜', w * 0.058, h * 0.255)
  ctx.fillText('行', w * 0.058, h * 0.295)
  ctx.fillStyle = 'rgba(222,100,72,.75)'
  ctx.fillRect(w * 0.83, h * 0.26, w * 0.035, h * 0.13)
  rain(ctx, w, h)
  ctx.fillStyle = 'rgba(238,201,133,.15)'
  ctx.beginPath()
  ctx.moveTo(w * 0.63, h * 0.53)
  ctx.lineTo(w, h * 0.46)
  ctx.lineTo(w, h * 0.7)
  ctx.lineTo(w * 0.52, h * 0.65)
  ctx.closePath()
  ctx.fill()
  rider(ctx, w * 0.63, h * 0.68, Math.min(w, h) / 280)
  for (let i = 0; i < 6; i += 1) {
    line(ctx, w * (0.27 + i * 0.03), h * (0.59 + i * 0.025), w * (0.5 + i * 0.03), h * (0.58 + i * 0.02), 'rgba(226,155,115,.15)', 1)
  }
  ctx.fillStyle = 'rgba(19,30,31,.45)'
  ctx.fillRect(0, h * 0.88, w, h * 0.12)
}

function drawTracking(ctx, w, h) {
  ctx.fillStyle = gradient(ctx, w, h, [[0, '#183b3d'], [0.6, '#44695e'], [1, '#1b3433']])
  ctx.fillRect(0, 0, w, h)
  glow(ctx, w * 0.83, h * 0.24, w * 0.33, 'rgba(242,180,105,.34)')
  glow(ctx, w * 0.16, h * 0.45, w * 0.3, 'rgba(208,76,58,.2)')
  ctx.fillStyle = 'rgba(210,223,203,.1)'
  for (let i = 0; i < 9; i += 1) {
    const x = ((i * 31) % 89) / 89 * w
    const y = ((i * 17) % 57) / 57 * h
    ctx.beginPath()
    ctx.arc(x, y, w * (0.012 + (i % 3) * 0.008), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.save()
  ctx.fillStyle = '#d05c45'
  ctx.beginPath()
  ctx.moveTo(w * 0.1, h * 0.06)
  ctx.quadraticCurveTo(w * 0.56, h * 0.02, w * 0.82, h * 0.32)
  ctx.quadraticCurveTo(w * 0.55, h * 0.45, w * 0.16, h * 0.65)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(40,58,54,.6)'
  ctx.lineWidth = w * 0.008
  for (let i = 0; i < 8; i += 1) {
    ctx.beginPath()
    ctx.moveTo(w * 0.17, h * (0.17 + i * 0.055))
    ctx.quadraticCurveTo(w * 0.48, h * (0.2 + i * 0.04), w * 0.77, h * (0.26 + i * 0.01))
    ctx.stroke()
  }
  ctx.restore()

  ctx.save()
  ctx.translate(w * 0.61, h * 0.73)
  ctx.rotate(-0.74)
  ctx.fillStyle = '#6f4437'
  ctx.beginPath()
  ctx.ellipse(0, 0, w * 0.13, h * 0.38, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#d8b18a'
  ctx.lineWidth = w * 0.022
  ctx.beginPath()
  ctx.moveTo(-w * 0.06, -h * 0.28)
  ctx.lineTo(-w * 0.045, h * 0.29)
  ctx.stroke()
  ctx.fillStyle = '#874a3b'
  ctx.beginPath()
  ctx.ellipse(-w * 0.01, -h * 0.18, w * 0.12, h * 0.07, 0.1, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#e1b48e'
  ctx.beginPath()
  ctx.arc(w * 0.075, -h * 0.35, w * 0.067, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#202d2c'
  ctx.beginPath()
  ctx.arc(w * 0.06, -h * 0.4, w * 0.074, Math.PI, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.strokeStyle = 'rgba(229,241,225,.28)'
  ctx.lineWidth = Math.max(1, w * 0.002)
  for (let i = 0; i < 12; i += 1) {
    const x = w * (0.6 + i * 0.035)
    line(ctx, x, h * 0.61, x + w * 0.11, h, 'rgba(217,234,221,.14)', 1)
  }
  ctx.restore()
  rain(ctx, w, h, 'rgba(225,245,237,.28)')
}

function drawDoorway(ctx, w, h) {
  ctx.fillStyle = gradient(ctx, w, h, [[0, '#241a18'], [1, '#5c3024']])
  ctx.fillRect(0, 0, w, h)
  rect(ctx, 0, 0, w, h, 'rgba(21,13,12,.2)')
  glow(ctx, w * 0.55, h * 0.48, w * 0.47, 'rgba(239,130,75,.5)')
  ctx.fillStyle = '#181313'
  ctx.fillRect(0, 0, w * 0.41, h)
  ctx.fillRect(w * 0.68, 0, w * 0.32, h)
  ctx.fillStyle = gradient(ctx, w, h, [[0, '#f1b778'], [0.6, '#dd7352'], [1, '#7d3a2d']])
  ctx.fillRect(w * 0.41, 0, w * 0.27, h)
  ctx.fillStyle = 'rgba(255,238,192,.33)'
  ctx.fillRect(w * 0.47, 0, w * 0.025, h)
  ctx.fillStyle = '#171312'
  ctx.beginPath()
  ctx.moveTo(w * 0.72, h * 0.18)
  ctx.quadraticCurveTo(w * 0.61, h * 0.3, w * 0.6, h * 0.75)
  ctx.lineTo(w * 0.82, h)
  ctx.lineTo(w, h)
  ctx.lineTo(w, h * 0.16)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#c89465'
  ctx.fillRect(w * 0.1, h * 0.51, w * 0.33, h * 0.21)
  ctx.fillStyle = '#e5c9a6'
  ctx.fillRect(w * 0.12, h * 0.49, w * 0.29, h * 0.065)
  line(ctx, w * 0.24, h * 0.51, w * 0.24, h * 0.7, '#b7865e', w * 0.007)
  ctx.strokeStyle = '#72513c'
  ctx.lineWidth = w * 0.005
  ctx.strokeRect(w * 0.14, h * 0.55, w * 0.12, h * 0.09)
  ctx.fillStyle = 'rgba(21,13,12,.45)'
  for (let i = 0; i < 7; i += 1) {
    ctx.fillRect(w * (0.43 + i * 0.033), 0, w * 0.006, h)
  }
}

function drawStairs(ctx, w, h) {
  ctx.fillStyle = gradient(ctx, w, h, [[0, '#31444b'], [0.55, '#6a7c7f'], [1, '#1e2c31']])
  ctx.fillRect(0, 0, w, h)
  glow(ctx, w * 0.72, h * 0.13, w * 0.4, 'rgba(163,221,206,.25)')
  ctx.fillStyle = '#25373c'
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(w * 0.32, 0)
  ctx.lineTo(w * 0.64, h * 0.63)
  ctx.lineTo(0, h * 0.63)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#1b292e'
  ctx.beginPath()
  ctx.moveTo(w, 0)
  ctx.lineTo(w * 0.77, 0)
  ctx.lineTo(w * 0.49, h * 0.62)
  ctx.lineTo(w, h * 0.62)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#718287'
  ctx.beginPath()
  ctx.moveTo(0, h * 0.61)
  ctx.lineTo(w, h * 0.61)
  ctx.lineTo(w, h)
  ctx.lineTo(0, h)
  ctx.closePath()
  ctx.fill()

  const stepCount = 9
  for (let i = 0; i < stepCount; i += 1) {
    const y = h * (0.61 + i * 0.052)
    const inset = w * i * 0.013
    ctx.fillStyle = i % 2 ? '#596b70' : '#4e6166'
    ctx.fillRect(inset, y, w - inset * 2, h * 0.033)
    rect(ctx, inset, y + h * 0.033, w - inset * 2, h * 0.021, i % 2 ? '#35484e' : '#3d5055')
  }
  ctx.strokeStyle = 'rgba(199,225,215,.35)'
  ctx.lineWidth = Math.max(1, w * 0.002)
  ctx.beginPath()
  ctx.moveTo(w * 0.64, h * 0.63)
  ctx.lineTo(w * 0.49, h * 0.62)
  ctx.lineTo(w * 0.49, 0)
  ctx.moveTo(w * 0.32, 0)
  ctx.lineTo(w * 0.64, h * 0.63)
  ctx.stroke()

  const sx = w * 0.9
  const sy = h * 0.58
  ctx.save()
  ctx.translate(sx, sy)
  ctx.rotate(0.15)
  ctx.fillStyle = '#152024'
  ctx.beginPath()
  ctx.arc(0, -h * 0.09, w * 0.034, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(-w * 0.035, -h * 0.055)
  ctx.lineTo(-w * 0.08, h * 0.065)
  ctx.lineTo(-w * 0.02, h * 0.15)
  ctx.lineTo(w * 0.02, h * 0.05)
  ctx.lineTo(w * 0.075, h * 0.13)
  ctx.lineTo(w * 0.11, h * 0.11)
  ctx.lineTo(w * 0.045, -h * 0.01)
  ctx.closePath()
  ctx.fill()
  line(ctx, w * 0.01, -h * 0.03, w * 0.18, h * 0.03, '#152024', w * 0.013)
  ctx.restore()
  ctx.fillStyle = 'rgba(19,29,33,.26)'
  ctx.beginPath()
  ctx.ellipse(w * 0.66, h * 0.83, w * 0.16, h * 0.1, -0.4, 0, Math.PI * 2)
  ctx.fill()
}

function drawCorridor(ctx, w, h) {
  ctx.fillStyle = gradient(ctx, w, h, [[0, '#2c1719'], [0.5, '#743735'], [1, '#28181a']])
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#4b2528'
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(w * 0.42, h * 0.23)
  ctx.lineTo(w * 0.42, h * 0.76)
  ctx.lineTo(0, h)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#562a2a'
  ctx.beginPath()
  ctx.moveTo(w, 0)
  ctx.lineTo(w * 0.58, h * 0.23)
  ctx.lineTo(w * 0.58, h * 0.76)
  ctx.lineTo(w, h)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#24171a'
  ctx.beginPath()
  ctx.moveTo(w * 0.42, h * 0.23)
  ctx.lineTo(w * 0.58, h * 0.23)
  ctx.lineTo(w * 0.58, h * 0.76)
  ctx.lineTo(w * 0.42, h * 0.76)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = gradient(ctx, w, h, [[0, '#dd8a6b'], [1, '#6f3534']])
  ctx.fillRect(w * 0.44, h * 0.25, w * 0.12, h * 0.5)
  glow(ctx, w * 0.5, h * 0.42, w * 0.32, 'rgba(233,135,102,.26)')
  for (let i = 0; i < 4; i += 1) {
    const p = i / 4
    ctx.strokeStyle = `rgba(237,174,143,${0.22 - p * 0.04})`
    ctx.lineWidth = Math.max(1, w * 0.002)
    ctx.beginPath()
    ctx.moveTo(w * (0.42 - p * 0.1), h * (0.23 + p * 0.1))
    ctx.lineTo(w * (0.42 - p * 0.1), h * (0.76 + p * 0.06))
    ctx.moveTo(w * (0.58 + p * 0.1), h * (0.23 + p * 0.1))
    ctx.lineTo(w * (0.58 + p * 0.1), h * (0.76 + p * 0.06))
    ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(241,169,132,.2)'
  ctx.lineWidth = Math.max(1, w * 0.002)
  for (let i = 0; i < 9; i += 1) {
    line(ctx, 0, h * (0.25 + i * 0.07), w * 0.42, h * (0.32 + i * 0.045), 'rgba(230,161,128,.15)', 1)
    line(ctx, w, h * (0.25 + i * 0.07), w * 0.58, h * (0.32 + i * 0.045), 'rgba(230,161,128,.15)', 1)
  }

  ctx.fillStyle = '#1a1113'
  ctx.beginPath()
  ctx.arc(w * 0.49, h * 0.49, w * 0.028, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(w * 0.455, h * 0.51)
  ctx.lineTo(w * 0.47, h * 0.74)
  ctx.lineTo(w * 0.51, h * 0.74)
  ctx.lineTo(w * 0.525, h * 0.51)
  ctx.closePath()
  ctx.fill()
  line(ctx, w * 0.47, h * 0.58, w * 0.43, h * 0.7, '#1a1113', w * 0.018)
  line(ctx, w * 0.51, h * 0.57, w * 0.55, h * 0.68, '#1a1113', w * 0.018)
  ctx.fillStyle = 'rgba(23,12,14,.65)'
  ctx.beginPath()
  ctx.ellipse(w * 0.39, h * 0.94, w * 0.1, h * 0.06, 0.2, 0, Math.PI * 2)
  ctx.fill()
}

function drawDawn(ctx, w, h) {
  ctx.fillStyle = gradient(ctx, w, h, [[0, '#8099aa'], [0.55, '#dbc8ac'], [1, '#e5d7bd']])
  ctx.fillRect(0, 0, w, h)
  glow(ctx, w * 0.7, h * 0.31, w * 0.48, 'rgba(246,208,132,.5)')
  rect(ctx, 0, h * 0.52, w, h * 0.48, '#9ca39c')
  ctx.fillStyle = 'rgba(113,132,135,.7)'
  for (let i = 0; i < 15; i += 1) {
    const bw = w * (0.03 + (i % 3) * 0.012)
    const bh = h * (0.08 + ((i * 11) % 13) * 0.018)
    ctx.fillRect(w * (i * 0.07), h * (0.52 - bh), bw, bh)
  }
  ctx.fillStyle = '#555e5e'
  ctx.beginPath()
  ctx.moveTo(0, h * 0.18)
  ctx.lineTo(w * 0.24, h * 0.08)
  ctx.lineTo(w * 0.38, h * 0.2)
  ctx.lineTo(w * 0.38, h)
  ctx.lineTo(0, h)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#d8c7a9'
  ctx.fillRect(0, h * 0.18, w * 0.24, h * 0.06)
  ctx.fillStyle = '#485252'
  ctx.beginPath()
  ctx.moveTo(w * 0.24, h * 0.26)
  ctx.lineTo(w * 0.84, h * 0.45)
  ctx.lineTo(w * 0.84, h)
  ctx.lineTo(w * 0.24, h)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = gradient(ctx, w, h, [[0, '#e7c990'], [1, '#aebdb7']])
  ctx.beginPath()
  ctx.moveTo(w * 0.31, h * 0.46)
  ctx.lineTo(w * 0.74, h * 0.54)
  ctx.lineTo(w * 0.74, h * 0.92)
  ctx.lineTo(w * 0.31, h * 0.92)
  ctx.closePath()
  ctx.fill()
  for (let i = 0; i < 5; i += 1) {
    rect(ctx, w * (0.31 + i * 0.088), h * 0.46, w * 0.006, h * 0.46, 'rgba(62,74,73,.4)')
  }
  ctx.fillStyle = '#ac7c4e'
  ctx.beginPath()
  ctx.moveTo(w * 0.39, h * 0.74)
  ctx.lineTo(w * 0.48, h * 0.72)
  ctx.lineTo(w * 0.54, h * 0.92)
  ctx.lineTo(w * 0.42, h * 0.92)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#b86146'
  ctx.fillRect(w * 0.43, h * 0.58, w * 0.09, h * 0.14)
  circle(ctx, w * 0.59, h * 0.53, w * 0.014, '#323c3c')
  ctx.fillStyle = 'rgba(239,217,173,.2)'
  ctx.fillRect(w * 0.31, h * 0.46, w * 0.43, h * 0.04)
  ctx.fillStyle = 'rgba(74,84,79,.0)'
}

const painters = {
  street: drawStreet,
  tracking: drawTracking,
  doorway: drawDoorway,
  stairs: drawStairs,
  corridor: drawCorridor,
  dawn: drawDawn,
}

export function paintArtwork(ctx, art, width, height) {
  ctx.clearRect(0, 0, width, height)
  painters[art](ctx, width, height)
}
