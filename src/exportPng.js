import { getTransition, totalDuration } from './data'
import { paintArtwork } from './artwork'

const WIDTH = 1400
const HEIGHT = 1980
const MARGIN = 92

function roundedRect(ctx, x, y, width, height, radius, fill, stroke) {
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, radius)
  if (fill) {
    ctx.fillStyle = fill
    ctx.fill()
  }
  if (stroke) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = 2
    ctx.stroke()
  }
}

function drawPaper(ctx) {
  ctx.fillStyle = '#f7f2e8'
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  ctx.fillStyle = '#fcfaf5'
  ctx.fillRect(38, 38, WIDTH - 76, HEIGHT - 76)
  ctx.strokeStyle = '#d7cfc1'
  ctx.lineWidth = 2
  ctx.strokeRect(38, 38, WIDTH - 76, HEIGHT - 76)
  ctx.strokeStyle = '#e7e0d4'
  ctx.lineWidth = 1
  ctx.strokeRect(48, 48, WIDTH - 96, HEIGHT - 96)

  ctx.strokeStyle = '#b5aa9b'
  ctx.lineWidth = 1.5
  const mark = 20
  const inset = 58
  const points = [
    [inset, inset, 1, 1], [WIDTH - inset, inset, -1, 1],
    [inset, HEIGHT - inset, 1, -1], [WIDTH - inset, HEIGHT - inset, -1, -1],
  ]
  points.forEach(([x, y, sx, sy]) => {
    ctx.beginPath()
    ctx.moveTo(x, y + sy * mark)
    ctx.lineTo(x, y)
    ctx.lineTo(x + sx * mark, y)
    ctx.stroke()
  })
}

function drawHeader(ctx, total, conflictCount) {
  const date = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())

  ctx.fillStyle = '#20221e'
  ctx.fillRect(MARGIN, 103, 34, 34)
  ctx.fillStyle = '#f5eee1'
  ctx.font = '700 18px "Noto Sans SC Variable", "Helvetica Neue", sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('M', MARGIN + 17, 126)
  ctx.textAlign = 'left'
  ctx.font = '600 13px "Noto Sans SC Variable", "Helvetica Neue", sans-serif'
  ctx.fillStyle = '#5e625b'
  ctx.fillText('MIDNIGHT RUN / PRODUCTION 04', MARGIN + 50, 117)
  ctx.fillStyle = '#9a5a46'
  ctx.fillText('STORYBOARD · REV 01', MARGIN + 50, 137)

  ctx.textAlign = 'right'
  ctx.fillStyle = '#686b64'
  ctx.font = '500 13px "Noto Sans SC Variable", "Helvetica Neue", sans-serif'
  ctx.fillText(date, WIDTH - MARGIN, 113)
  ctx.fillText('A4 / 300 DPI', WIDTH - MARGIN, 134)

  ctx.textAlign = 'left'
  ctx.fillStyle = '#20221e'
  ctx.font = '600 58px "Noto Serif SC Variable", "Songti SC", Georgia, serif'
  ctx.fillText('午夜快递', MARGIN, 225)
  ctx.fillStyle = '#8c8c81'
  ctx.font = '400 13px "Noto Sans SC Variable", "Helvetica Neue", sans-serif'
  ctx.fillText('SHOT SEQUENCE / 分镜序列', MARGIN + 250, 207)
  ctx.fillText('SCENE 04  ·  巷口 → 地下 → 出口', MARGIN + 250, 228)

  const metaY = 272
  ctx.strokeStyle = '#d9d1c4'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(MARGIN, metaY)
  ctx.lineTo(WIDTH - MARGIN, metaY)
  ctx.stroke()
  const meta = [
    ['镜头', '06', 'SHOTS'],
    ['总时长', `00:${total.toFixed(1).padStart(4, '0')}`, 'RUNTIME'],
    ['画幅', '16 : 9', 'ASPECT'],
    ['方向冲突', String(conflictCount).padStart(2, '0'), 'AXIS'],
  ]
  meta.forEach(([label, value, sub], index) => {
    const x = MARGIN + index * 302
    ctx.fillStyle = '#96978e'
    ctx.font = '500 10px "Noto Sans SC Variable", "Helvetica Neue", sans-serif'
    ctx.fillText(label, x, metaY + 24)
    ctx.fillStyle = index === 3 && conflictCount ? '#b84e37' : '#242620'
    ctx.font = '600 22px "Noto Sans SC Variable", "Helvetica Neue", sans-serif'
    ctx.fillText(value, x, metaY + 51)
    ctx.fillStyle = '#aeaca2'
    ctx.font = '500 9px "Noto Sans SC Variable", "Helvetica Neue", sans-serif'
    ctx.fillText(sub, x + ctx.measureText(value).width + 18, metaY + 49)
  })
}

function drawArtworkTile(ctx, shot, x, y, width, height) {
  const art = document.createElement('canvas')
  art.width = 720
  art.height = 405
  paintArtwork(art.getContext('2d'), shot.art, art.width, art.height)
  ctx.drawImage(art, x, y, width, height)
}

function drawArrow(ctx, x, y, direction, color) {
  ctx.save()
  ctx.translate(x, y)
  if (direction < 0) ctx.rotate(Math.PI)
  ctx.strokeStyle = color
  ctx.lineWidth = 1.8
  ctx.beginPath()
  ctx.moveTo(-10, 0)
  ctx.lineTo(10, 0)
  ctx.moveTo(5, -5)
  ctx.lineTo(10, 0)
  ctx.lineTo(5, 5)
  ctx.stroke()
  ctx.restore()
}

function drawPanel(ctx, shot, sequence, index, x, y, width, hasConflict) {
  const artHeight = width * 9 / 16
  const panelHeight = artHeight + 104
  ctx.save()
  roundedRect(ctx, x, y, width, panelHeight, 4, '#ede8de')
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, y, width, artHeight, [4, 4, 0, 0])
  ctx.clip()
  drawArtworkTile(ctx, shot, x, y, width, artHeight)
  const shade = ctx.createLinearGradient(0, y, 0, y + artHeight)
  shade.addColorStop(0, 'rgba(0,0,0,.2)')
  shade.addColorStop(0.35, 'rgba(0,0,0,0)')
  shade.addColorStop(1, 'rgba(0,0,0,.13)')
  ctx.fillStyle = shade
  ctx.fillRect(x, y, width, artHeight)
  ctx.restore()

  ctx.fillStyle = 'rgba(18,20,17,.86)'
  ctx.fillRect(x + 10, y + 10, 68, 24)
  ctx.fillStyle = '#f8f2e7'
  ctx.font = '600 11px "Noto Sans SC Variable", "Helvetica Neue", sans-serif'
  ctx.fillText(`SHOT ${shot.id}`, x + 20, y + 26)

  if (hasConflict) {
    ctx.strokeStyle = '#d95f45'
    ctx.lineWidth = 4
    ctx.strokeRect(x + 2, y + 2, width - 4, artHeight - 4)
    ctx.fillStyle = '#d95f45'
    ctx.fillRect(x + width - 79, y + 10, 69, 24)
    ctx.fillStyle = '#fff8ed'
    ctx.font = '700 10px "Noto Sans SC Variable", "Helvetica Neue", sans-serif'
    ctx.fillText('轴 向 警 告', x + width - 69, y + 26)
  }

  const bodyY = y + artHeight
  ctx.fillStyle = '#20211d'
  ctx.font = '600 24px "Noto Sans SC Variable", "Helvetica Neue", sans-serif'
  ctx.fillText(shot.title, x + 15, bodyY + 32)
  ctx.fillStyle = '#95948b'
  ctx.font = '600 10px "Noto Sans SC Variable", "Helvetica Neue", sans-serif'
  ctx.fillText(shot.titleEn, x + 15, bodyY + 49)
  ctx.textAlign = 'right'
  ctx.fillStyle = '#6c6f67'
  ctx.font = '500 12px "Noto Sans SC Variable", "Helvetica Neue", sans-serif'
  ctx.fillText(`${shot.viewpoint}  ·  ${shot.lens}`, x + width - 15, bodyY + 31)
  ctx.fillStyle = '#9c9b91'
  ctx.font = '500 11px "Noto Sans SC Variable", "Helvetica Neue", sans-serif'
  ctx.fillText(`时长 ${shot.duration.toFixed(1)}s`, x + width - 15, bodyY + 50)
  ctx.textAlign = 'left'

  drawArrow(ctx, x + 25, bodyY + 77, shot.direction, hasConflict ? '#c64f39' : '#4b776d')
  ctx.fillStyle = hasConflict ? '#c64f39' : '#50534c'
  ctx.font = '500 11px "Noto Sans SC Variable", "Helvetica Neue", sans-serif'
  ctx.fillText(shot.action, x + 43, bodyY + 80)

  const nextId = sequence[index + 1]
  if (nextId) {
    const transition = getTransition(shot.id, nextId)
    ctx.textAlign = 'right'
    ctx.fillStyle = '#aaa79c'
    ctx.font = '500 10px "Noto Sans SC Variable", "Helvetica Neue", sans-serif'
    ctx.fillText(`${transition.label} ${transition.duration ? `${transition.duration.toFixed(1)}s` : ''}  →`, x + width - 15, bodyY + 80)
  }
  ctx.restore()
}

export function buildExportCanvas({ sequence, conflictCount, shotsById }) {
  const lookupShot = (id) => shotsById[id]
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')
  drawPaper(ctx)
  drawHeader(ctx, totalDuration(sequence, lookupShot), conflictCount)

  const gapX = 22
  const gapY = 24
  const panelWidth = (WIDTH - MARGIN * 2 - gapX) / 2
  const artHeight = panelWidth * 9 / 16
  const panelHeight = artHeight + 104
  const startY = 342
  const conflicts = new Set()
  sequence.slice(0, -1).forEach((id, index) => {
    const a = lookupShot(id)
    const b = lookupShot(sequence[index + 1])
    if (a.direction !== 0 && b.direction !== 0 && a.direction !== b.direction) {
      conflicts.add(id)
      conflicts.add(b.id)
    }
  })

  sequence.forEach((id, index) => {
    const column = index % 2
    const row = Math.floor(index / 2)
    const x = MARGIN + column * (panelWidth + gapX)
    const y = startY + row * (panelHeight + gapY)
    drawPanel(ctx, lookupShot(id), sequence, index, x, y, panelWidth, conflicts.has(id))
  })

  const footerY = startY + panelHeight * 3 + gapY * 2 + 26
  ctx.strokeStyle = '#d9d1c4'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(MARGIN, footerY)
  ctx.lineTo(WIDTH - MARGIN, footerY)
  ctx.stroke()
  ctx.fillStyle = '#7c7e75'
  ctx.font = '500 11px "Noto Sans SC Variable", "Helvetica Neue", sans-serif'
  ctx.fillText('AXIS NOTE', MARGIN, footerY + 25)
  ctx.fillStyle = conflictCount ? '#b84e37' : '#43675f'
  ctx.font = '600 13px "Noto Sans SC Variable", "Helvetica Neue", sans-serif'
  ctx.fillText(
    conflictCount ? `${conflictCount} 处动作方向冲突 · 红色镜头为越轴位置` : '相邻镜头动作方向连续',
    MARGIN,
    footerY + 47,
  )
  ctx.fillStyle = '#9e9c92'
  ctx.font = '500 10px "Noto Sans SC Variable", "Helvetica Neue", sans-serif'
  ctx.fillText('VIEWPOINT CONTINUITY  ·  动作方向与视点关系由分镜台自动校验', MARGIN, footerY + 67)
  const revision = sequence.join('  /  ')
  ctx.textAlign = 'right'
  ctx.fillStyle = '#85877d'
  ctx.font = '500 10px "Noto Sans SC Variable", "Helvetica Neue", sans-serif'
  ctx.fillText(`SEQUENCE  ${revision}`, WIDTH - MARGIN, footerY + 25)
  ctx.fillStyle = '#b2aea2'
  ctx.fillText('MIDNIGHT RUN  /  PAGE 01 OF 01', WIDTH - MARGIN, footerY + 67)
  ctx.textAlign = 'left'
  return canvas
}

export async function exportStoryboardPng(options) {
  await document.fonts.ready
  const canvas = buildExportCanvas(options)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = '午夜快递_分镜序列_A4.png'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
