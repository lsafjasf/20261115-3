import { useEffect, useMemo, useState } from 'react'
import Icon from './icons'
import Storyboard, { Timeline } from './Storyboard'
import Sidebar from './Sidebar'
import TransitionModal from './TransitionModal'
import { analyzeSequence, getTransition, initialSequence, originalSequence, shots, totalDuration } from './data'
import { exportStoryboardPng } from './exportPng'

const initialRevision = {
  count: 1,
  movedId: '05',
  message: '本次调整：镜头 05 从第 5 位移至第 3 位',
  detail: '第 5 位 → 第 3 位',
}

function App() {
  const [sequence, setSequence] = useState(initialSequence)
  const [shotsById, setShotsById] = useState(() => (
    Object.fromEntries(shots.map((shot) => [shot.id, shot]))
  ))
  const [customTransitions, setCustomTransitions] = useState({})
  const [revision, setRevision] = useState(initialRevision)
  const [draggingId, setDraggingId] = useState(null)
  const [dropTargetId, setDropTargetId] = useState(null)
  const [selection, setSelection] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [exportReady, setExportReady] = useState(false)
  const [toast, setToast] = useState({
    kind: 'warning',
    title: '已实际调整一次顺序',
    message: '镜头 05 移至第 3 位，系统已自动标出 1 处方向冲突。',
  })

  const conflict = useMemo(() => analyzeSequence(sequence, (id) => shotsById[id]), [sequence, shotsById])
  const total = useMemo(() => totalDuration(sequence, (id) => shotsById[id]), [sequence, shotsById])

  const resolvedTransitions = useMemo(() => {
    const result = {}
    sequence.slice(0, -1).forEach((from, index) => {
      const to = sequence[index + 1]
      const key = `${from}-${to}`
      result[key] = customTransitions[key] || getTransition(from, to)
    })
    return result
  }, [sequence, customTransitions])

  const conflictPairs = useMemo(() => (
    new Set(conflict.directionConflicts.map(({ from, to }) => `${from}-${to}`))
  ), [conflict])

  const conflictShotIds = useMemo(() => {
    const ids = new Set()
    conflict.directionConflicts.forEach(({ from, to }) => {
      ids.add(from)
      ids.add(to)
    })
    return ids
  }, [conflict])

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), 7200)
    return () => clearTimeout(timer)
  }, [toast])

  function handleDragStart(event, id) {
    setDraggingId(id)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
    requestAnimationFrame(() => event.target.closest('.shot-card')?.classList.add('drag-origin'))
  }

  function handleDragEnd(event) {
    event.target.closest('.shot-card')?.classList.remove('drag-origin')
    setDraggingId(null)
    setDropTargetId(null)
  }

  function handleDragOver(event, id) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (id !== draggingId) setDropTargetId(id)
  }

  function handleDrop(event, targetId) {
    event.preventDefault()
    const sourceId = draggingId || event.dataTransfer.getData('text/plain')
    setDropTargetId(null)
    setDraggingId(null)
    if (!sourceId || sourceId === targetId) return

    const fromIndex = sequence.indexOf(sourceId)
    const targetIndex = sequence.indexOf(targetId)
    if (fromIndex < 0 || targetIndex < 0) return
    const next = [...sequence]
    next.splice(fromIndex, 1)
    next.splice(targetIndex, 0, sourceId)
    const nextConflicts = analyzeSequence(next, (id) => shotsById[id]).directionConflicts.length
    setSequence(next)
    setRevision((previous) => ({
      count: previous.count + 1,
      movedId: sourceId,
      message: `本次调整：镜头 ${sourceId} 从第 ${fromIndex + 1} 位移至第 ${next.indexOf(sourceId) + 1} 位`,
      detail: `第 ${fromIndex + 1} 位 → 第 ${next.indexOf(sourceId) + 1} 位`,
    }))
    setToast({
      kind: nextConflicts ? 'warning' : 'success',
      title: nextConflicts ? '排序已更新 · 发现方向冲突' : '排序已更新 · 方向连续',
      message: nextConflicts
        ? `系统检测到 ${nextConflicts} 处相邻镜头的动作方向矛盾，已在连接线标红。`
        : '新的相邻镜头动作方向与视点连接保持连续。',
    })
  }

  function handleDuration(id, delta) {
    setShotsById((previous) => {
      const nextDuration = Math.min(8, Math.max(0.4, previous[id].duration + delta))
      return {
        ...previous,
        [id]: { ...previous[id], duration: Number(nextDuration.toFixed(1)) },
      }
    })
  }

  function openTransition(index) {
    const from = sequence[index]
    const to = sequence[index + 1]
    if (!from || !to) return
    const key = `${from}-${to}`
    setSelection({
      from,
      to,
      index,
      pairKey: key,
      transition: resolvedTransitions[key],
    })
  }

  function focusConflict() {
    const pair = conflict.directionConflicts[0]
    if (!pair) return
    const index = sequence.findIndex((id, position) => id === pair.from && sequence[position + 1] === pair.to)
    if (index >= 0) openTransition(index)
  }

  function applyTransition(draft) {
    if (!selection) return
    setCustomTransitions((previous) => ({
      ...previous,
      [selection.pairKey]: draft,
    }))
    setToast({
      kind: 'success',
      title: '转场已更新',
      message: `${selection.from} → ${selection.to} 改为${draft.type}${draft.duration ? ` · ${draft.duration.toFixed(1)}s` : ''}`,
    })
  }

  function resetSequence() {
    setSequence(originalSequence)
    setRevision({
      count: 1,
      movedId: null,
      message: '已恢复原始序列，方向轴恢复连续',
      detail: '原始序列 · 未应用换序',
    })
    setToast({
      kind: 'success',
      title: '已恢复原始顺序',
      message: '拖动手柄可再次调整镜头顺序并重新执行方向检查。',
    })
  }

  async function handleExport() {
    setExporting(true)
    try {
      await new Promise((resolve) => setTimeout(resolve, 240))
      await exportStoryboardPng({
        sequence,
        conflictCount: conflict.directionConflicts.length,
        shotsById,
      })
      setExportReady(true)
      setToast({
        kind: 'success',
        title: 'PNG 已导出',
        message: `A4 PDF 风格分镜页 · ${conflict.directionConflicts.length ? '含方向冲突标注' : '方向连续'} · 300 DPI`,
      })
    } catch {
      setToast({
        kind: 'warning',
        title: '导出未完成',
        message: '浏览器阻止了文件下载，请检查下载权限后重试。',
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">M</span>
          <div className="brand-copy">
            <strong>MONTA</strong>
            <span>STORYBOARD DESK</span>
          </div>
        </div>
        <div className="breadcrumbs">
          <span>项目</span>
          <Icon name="chevron" size={12} />
          <strong>午夜快递</strong>
          <span className="crumb-scene">SCENE 04</span>
        </div>
        <div className="top-actions">
          <span className="save-state"><i /> 已自动保存</span>
          <button type="button" className="version-button" title="版本记录">
            <Icon name="layers" size={15} />
            <span>REV {revision.count.toString().padStart(2, '0')}</span>
          </button>
          <button type="button" className="top-export" onClick={handleExport} disabled={exporting}>
            <Icon name="download" size={16} />
            {exporting ? '正在导出…' : '导出 PDF 风格 PNG'}
          </button>
        </div>
      </header>

      <main className="app-main">
        <div className="board-column">
          <Storyboard
            sequence={sequence}
            transitions={resolvedTransitions}
            conflictPairs={conflictPairs}
            conflictShotIds={conflictShotIds}
            revisedId={revision.movedId}
            draggingId={draggingId}
            dropTargetId={dropTargetId}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDuration={handleDuration}
            onEditTransition={openTransition}
            onReset={resetSequence}
            revision={revision}
            conflictCount={conflict.directionConflicts.length}
            shotsById={shotsById}
          />
          <Timeline
            sequence={sequence}
            transitions={resolvedTransitions}
            conflictPairs={conflictPairs}
            total={total}
            shotsById={shotsById}
          />
        </div>
        <Sidebar
          sequence={sequence}
          conflict={conflict}
          revision={revision}
          onReset={resetSequence}
          onFocusConflict={focusConflict}
          onExport={handleExport}
          exporting={exporting}
          exportReady={exportReady}
          shotsById={shotsById}
        />
      </main>

      <footer className="app-footer">
        <span>MONTA / STORYBOARD SYSTEM</span>
        <span>方向轴校验 · 24 FPS · 16:9 · A4 OUTPUT</span>
        <span>© 2026 PRODUCTION 04</span>
      </footer>

      {selection && (
        <TransitionModal
          selection={selection}
          conflict={conflictPairs.has(selection.pairKey)}
          onClose={() => setSelection(null)}
          onApply={applyTransition}
          shotsById={shotsById}
        />
      )}

      {toast && (
        <div className={`toast toast-${toast.kind}`} role="status">
          <span className="toast-icon">
            <Icon name={toast.kind === 'success' ? 'check' : 'warning'} size={16} strokeWidth={2.2} />
          </span>
          <div>
            <strong>{toast.title}</strong>
            <p>{toast.message}</p>
          </div>
          <button type="button" onClick={() => setToast(null)} aria-label="关闭提示">
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

export default App
