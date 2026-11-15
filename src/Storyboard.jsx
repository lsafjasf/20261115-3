import Icon from './icons'
import ShotArt from './ShotArt'

function DirectionTag({ shot }) {
  const directionClass = shot.direction > 0 ? 'right' : shot.direction < 0 ? 'left' : 'neutral'
  return (
    <span className={`direction-tag ${directionClass}`}>
      {shot.direction === 0
        ? <span className="neutral-dot" />
        : <Icon name={shot.direction > 0 ? 'arrow' : 'arrowLeft'} size={12} strokeWidth={2} />}
      {shot.action}
    </span>
  )
}

function ShotCard({
  shot,
  index,
  conflict,
  isDragging,
  isDropTarget,
  isRevised,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onDuration,
}) {
  return (
    <article
      className={[
        'shot-card',
        conflict ? 'has-conflict' : '',
        isDragging ? 'is-dragging' : '',
        isDropTarget ? 'is-drop-target' : '',
        isRevised ? 'is-revised' : '',
      ].filter(Boolean).join(' ')}
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-shot-id={shot.id}
    >
      <div className="shot-frame">
        <ShotArt art={shot.art} label={`${shot.id} ${shot.title} 分镜画面`} />
        <div className="frame-shade" />
        <div className="shot-number">
          <span>SHOT</span>
          <strong>{shot.id}</strong>
        </div>
        <button
          className="drag-handle"
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          title="拖动调整镜头顺序"
          aria-label={`拖动镜头 ${shot.id} 调整顺序`}
        >
          <Icon name="grip" size={15} />
        </button>
        {conflict && <span className="conflict-flag">越轴</span>}
        {isRevised && !conflict && <span className="revised-flag">MOVE</span>}
        <DirectionTag shot={shot} />
      </div>

      <div className="shot-body">
        <div className="shot-title-row">
          <div>
            <h3>{shot.title}</h3>
            <span className="shot-en">{shot.titleEn}</span>
          </div>
          <span className="shot-index">{String(index + 1).padStart(2, '0')}</span>
        </div>

        <div className="viewpoint-line">
          <Icon name="eye" size={13} />
          <span>{shot.viewpoint}</span>
        </div>
        <div className="lens-line">{shot.lens} <span>·</span> {shot.axis}</div>

        <div className="duration-control" aria-label={`镜头 ${shot.id} 时长`}>
          <span className="duration-label">DURATION</span>
          <div className="duration-stepper">
            <button
              type="button"
              aria-label="减少时长"
              onClick={() => onDuration(shot.id, -0.2)}
              disabled={shot.duration <= 0.4}
            >
              <Icon name="minus" size={11} strokeWidth={2.2} />
            </button>
            <strong>{shot.duration.toFixed(1)}<small>s</small></strong>
            <button
              type="button"
              aria-label="增加时长"
              onClick={() => onDuration(shot.id, 0.2)}
              disabled={shot.duration >= 8}
            >
              <Icon name="plus" size={11} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}

function Connector({ from, to, transition, conflict, index, onEdit, lookupShot }) {
  const fromShot = lookupShot(from)
  const toShot = lookupShot(to)
  return (
    <div className={`connector ${conflict ? 'connector-conflict' : ''}`}>
      <button
        type="button"
        className="connector-button"
        onClick={onEdit}
        aria-label={`编辑镜头 ${from} 到 ${to} 的转场`}
        title="点击编辑转场"
      >
        <span className="connector-line" />
        {conflict ? (
          <span className="conflict-mark">
            <Icon name="warning" size={12} strokeWidth={2} />
          </span>
        ) : (
          <span className="transition-glyph">
            {transition.type === '硬切' ? '│' : transition.type === '叠化' ? '◒' : transition.type === '黑场' ? '◼' : transition.type === '推移' ? '→' : '✦'}
          </span>
        )}
        <span className="transition-label">
          {conflict ? '方向冲突' : transition.type}
          {!conflict && transition.duration > 0 && <small>{transition.duration.toFixed(1)}s</small>}
        </span>
        <span className="connector-pov">
          <Icon name="eye" size={9} />
          {fromShot.viewCode}→{toShot.viewCode}
        </span>
        <span className="connector-edit">编辑</span>
      </button>
      <span className="connector-index">{index + 1}</span>
    </div>
  )
}

export default function Storyboard({
  sequence,
  transitions,
  conflictPairs,
  conflictShotIds,
  revisedId,
  draggingId,
  dropTargetId,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onDuration,
  onEditTransition,
  onReset,
  revision,
  conflictCount,
  shotsById,
}) {
  const lookupShot = (id) => shotsById[id]
  return (
    <section className="storyboard-panel">
      <header className="storyboard-head">
        <div>
          <span className="eyebrow">SHOT SEQUENCE / 镜头序列</span>
          <div className="title-line">
            <h1>雨夜追踪</h1>
            <span className="scene-tag">SCENE 04</span>
          </div>
        </div>
        <div className="sequence-status">
          <span className="live-dot" />
          <span>方向轴自动校验</span>
          <span className={`rule-count ${conflictCount ? 'has-error' : ''}`}>
            {conflictCount ? `${conflictCount} 处冲突` : '全部连续'}
          </span>
          <button type="button" className="icon-button subtle" aria-label="更多序列设置">
            <Icon name="more" size={18} />
          </button>
        </div>
      </header>

      <div className="sequence-scroller">
        <div className="sequence-row">
          {sequence.map((id, index) => {
            const shot = lookupShot(id)
            const nextId = sequence[index + 1]
            const pairKey = nextId ? `${id}-${nextId}` : null
            return (
              <div className="sequence-unit" key={id}>
                <ShotCard
                  shot={shot}
                  index={index}
                  conflict={conflictShotIds.has(id)}
                  isDragging={draggingId === id}
                  isDropTarget={dropTargetId === id && draggingId !== id}
                  isRevised={revisedId === id}
                  onDragStart={(event) => onDragStart(event, id)}
                  onDragEnd={onDragEnd}
                  onDragOver={(event) => onDragOver(event, id)}
                  onDrop={(event) => onDrop(event, id)}
                  onDuration={onDuration}
                />
                {nextId && (
                  <Connector
                    from={id}
                    to={nextId}
                    transition={transitions[pairKey]}
                    conflict={conflictPairs.has(pairKey)}
                    index={index}
                    onEdit={() => onEditTransition(index)}
                    lookupShot={lookupShot}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className={`revision-note ${conflictCount ? 'revision-note-alert' : ''}`}>
        <span className="revision-badge">REV {revision.count.toString().padStart(2, '0')}</span>
        <Icon name="undo" size={14} />
        <span>{revision.message}</span>
        {conflictCount > 0 && (
          <span className="revision-warning">
            <Icon name="warning" size={13} />
            已标出 {conflictCount} 处方向冲突
          </span>
        )}
        <button type="button" className="revision-reset" onClick={onReset}>
          恢复原序
        </button>
      </div>
    </section>
  )
}

export function Timeline({ sequence, conflictPairs, total, shotsById }) {
  return (
    <section className="timeline-panel">
      <header className="timeline-head">
        <div className="timeline-title">
          <Icon name="clock" size={15} />
          <span>时间线</span>
          <small>TIMELINE / 24 FPS</small>
        </div>
        <div className="timeline-total">
          <span>TOTAL</span>
          <strong>00:{total.toFixed(1).padStart(4, '0')}</strong>
        </div>
      </header>
      <div className="timeline-body">
        <div className="timeline-track">
          {sequence.map((id, index) => {
            const shot = shotsById[id]
            const nextId = sequence[index + 1]
            const pairKey = nextId ? `${id}-${nextId}` : null
            return (
              <div
                className={`timeline-clip ${conflictPairs.has(pairKey) ? 'clip-conflict' : ''}`}
                style={{ flexGrow: shot.duration }}
                key={id}
                title={`${shot.id} ${shot.title} · ${shot.duration.toFixed(1)}s`}
              >
                <span className="clip-color" style={{ background: shot.tone }} />
                <strong>{shot.id}</strong>
                <span className="clip-title">{shot.title}</span>
                <small>{shot.duration.toFixed(1)}s</small>
                {(shot.direction !== 0) && (
                  <Icon name={shot.direction > 0 ? 'arrow' : 'arrowLeft'} size={10} strokeWidth={2} />
                )}
                {conflictPairs.has(pairKey) && <span className="clip-alert" />}
              </div>
            )
          })}
        </div>
        <div className="timeline-ruler">
          {[0, 3, 6, 9, 12, 15].map((tick) => <span key={tick}>{tick}s</span>)}
          <span>{(Math.ceil(total / 3) * 3)}s</span>
        </div>
        <div className="timeline-foot">
          <span><i className="legend-dot same" /> 同轴推进</span>
          <span><i className="legend-dot neutral" /> 中性缓冲</span>
          <span><i className="legend-dot conflict" /> 方向反转</span>
          <span className="timeline-hint">拖动缩略图把手可重排顺序 · 点击连接线编辑转场</span>
        </div>
      </div>
    </section>
  )
}
