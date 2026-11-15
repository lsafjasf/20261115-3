export const shots = [
  {
    id: '01',
    title: '雨幕开场',
    titleEn: 'ESTABLISHING',
    lens: 'WIDE · 24mm',
    duration: 3.2,
    direction: 1,
    action: '向右骑行',
    viewpoint: '高位俯拍 / 正面',
    viewCode: '正',
    axis: '东 → 西',
    tone: '#2f706c',
    accent: '#e16b46',
    art: 'street',
  },
  {
    id: '02',
    title: '贴地追踪',
    titleEn: 'TRACKING',
    lens: 'TRACK · 35mm',
    duration: 2.4,
    direction: 1,
    action: '向右穿行',
    viewpoint: '右侧跟拍 / 侧面',
    viewCode: '侧',
    axis: '东 → 西',
    tone: '#43665d',
    accent: '#f0a24b',
    art: 'tracking',
  },
  {
    id: '03',
    title: '门缝一瞥',
    titleEn: 'INSERT / POV',
    lens: 'INSERT · 50mm',
    duration: 1.2,
    direction: 0,
    action: '静止递物',
    viewpoint: '主观视角 / 正面',
    viewCode: '正',
    axis: '轴线内收',
    tone: '#874b36',
    accent: '#f2bb78',
    art: 'doorway',
  },
  {
    id: '04',
    title: '地下回声',
    titleEn: 'WIDE / DESCEND',
    lens: 'WIDE · 28mm',
    duration: 2.8,
    direction: -1,
    action: '向左下楼',
    viewpoint: '正面 / 俯视',
    viewCode: '正',
    axis: '西 ← 东',
    tone: '#41515a',
    accent: '#8ec8bd',
    art: 'stairs',
  },
  {
    id: '05',
    title: '走廊反打',
    titleEn: 'REVERSE',
    lens: 'REVERSE · 50mm',
    duration: 2.0,
    direction: -1,
    action: '向左推进',
    viewpoint: '低角度 / 背面',
    viewCode: '背',
    axis: '西 ← 东',
    tone: '#713a38',
    accent: '#e88768',
    art: 'corridor',
  },
  {
    id: '06',
    title: '黎明出口',
    titleEn: 'WIDE / RELEASE',
    lens: 'WIDE · 24mm',
    duration: 3.5,
    direction: 0,
    action: '走出画面',
    viewpoint: '远景 / 平视',
    viewCode: '平',
    axis: '轴线释放',
    tone: '#718da0',
    accent: '#f1ca7e',
    art: 'dawn',
  },
]

export const originalSequence = shots.map((shot) => shot.id)
export const initialSequence = ['01', '02', '05', '03', '04', '06']

export const transitions = {
  '01-02': { type: '叠化', duration: 0.6, label: 'DISSOLVE' },
  '02-03': { type: '硬切', duration: 0, label: 'CUT' },
  '03-04': { type: '黑场', duration: 0.4, label: 'FADE' },
  '04-05': { type: '推移', duration: 0.5, label: 'PUSH' },
  '05-06': { type: '叠化', duration: 0.8, label: 'DISSOLVE' },
}

export const transitionTypes = [
  { name: '硬切', label: 'CUT', glyph: '│' },
  { name: '叠化', label: 'DISSOLVE', glyph: '◒' },
  { name: '推移', label: 'PUSH', glyph: '→' },
  { name: '划像', label: 'WIPE', glyph: '▰' },
  { name: '黑场', label: 'FADE', glyph: '◼' },
  { name: '闪白', label: 'FLASH', glyph: '✦' },
]

export function getShot(id) {
  return shots.find((shot) => shot.id === id)
}

export function getTransition(from, to) {
  return transitions[`${from}-${to}`] || { type: '硬切', duration: 0, label: 'CUT' }
}

export function getConnections(sequence) {
  return sequence.slice(0, -1).map((from, index) => ({
    from,
    to: sequence[index + 1],
    index,
    transition: getTransition(from, sequence[index + 1]),
  }))
}

export function analyzeSequence(sequence, lookupShot = getShot) {
  const directionConflicts = []
  const viewWarnings = []

  sequence.slice(0, -1).forEach((fromId, index) => {
    const from = lookupShot(fromId)
    const to = lookupShot(sequence[index + 1])
    if (from.direction !== 0 && to.direction !== 0 && from.direction !== to.direction) {
      directionConflicts.push({
        from: fromId,
        to: to.id,
        fromDirection: from.direction,
        toDirection: to.direction,
        message: `${from.id} 向右推进，${to.id} 立即向左运动，动作轴在此反转。`,
        suggestion: `将 ${to.id} 移到向左运动的镜头之后，或让 ${to.id} 从静止动作开始。`,
      })
    }
  })

  return { directionConflicts, viewWarnings }
}

export function totalDuration(sequence, lookupShot = getShot) {
  return sequence.reduce((total, id) => total + lookupShot(id).duration, 0)
}
