import { useEffect, useState } from 'react'
import Icon from './icons'
import { transitionTypes } from './data'

export default function TransitionModal({ selection, conflict, onClose, onApply, shotsById }) {
  const [draft, setDraft] = useState(selection.transition)

  useEffect(() => {
    setDraft(selection.transition)
  }, [selection])

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const from = shotsById[selection.from]
  const to = shotsById[selection.to]

  function selectType(type) {
    setDraft({
      type: type.name,
      label: type.label,
      duration: type.name === '硬切' ? 0 : draft.duration || 0.6,
    })
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="transition-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transition-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <span className="eyebrow">CONNECTION EDITOR / 连接线</span>
            <h2 id="transition-title">编辑转场</h2>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className={`transition-pair ${conflict ? 'has-conflict' : ''}`}>
          <div className="pair-shot">
            <span className="pair-thumb" style={{ background: from.tone }}>{from.id}</span>
            <div>
              <strong>{from.title}</strong>
              <small>{from.viewCode}向视点 · {from.action}</small>
            </div>
          </div>
          <div className="pair-connector">
            <span />
            <Icon name="chevron" size={14} />
          </div>
          <div className="pair-shot">
            <span className="pair-thumb" style={{ background: to.tone }}>{to.id}</span>
            <div>
              <strong>{to.title}</strong>
              <small>{to.viewCode}向视点 · {to.action}</small>
            </div>
          </div>
          {conflict && (
            <div className="pair-warning">
              <Icon name="warning" size={13} />
              此处动作方向相反，建议改用中性动作或重排镜头。
            </div>
          )}
        </div>

        <div className="modal-section">
          <div className="modal-label">
            <span>转场类型</span>
            <small>TRANSITION TYPE</small>
          </div>
          <div className="transition-options">
            {transitionTypes.map((type) => (
              <button
                type="button"
                key={type.name}
                className={draft.type === type.name ? 'selected' : ''}
                onClick={() => selectType(type)}
              >
                <span className="type-glyph">{type.glyph}</span>
                <strong>{type.name}</strong>
                <small>{type.label}</small>
                {draft.type === type.name && <span className="selected-tick"><Icon name="check" size={10} /></span>}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-section">
          <div className="modal-label duration-label-row">
            <span>转场时长</span>
            <strong>{draft.type === '硬切' ? '0.0' : draft.duration.toFixed(1)} <small>秒</small></strong>
          </div>
          <div className="transition-slider">
            <input
              type="range"
              min="0.1"
              max="2"
              step="0.1"
              value={draft.type === '硬切' ? 0.1 : draft.duration}
              disabled={draft.type === '硬切'}
              onChange={(event) => setDraft({ ...draft, duration: Number(event.target.value) })}
              aria-label="转场时长"
            />
            <div className="slider-scale"><span>0.1s</span><span>1.0s</span><span>2.0s</span></div>
          </div>
          <p className="duration-help">
            <Icon name="clock" size={12} />
            转场时长叠加在镜头间，不改变总镜头时长。
          </p>
        </div>

        <footer className="modal-foot">
          <button type="button" className="button-secondary" onClick={onClose}>取消</button>
          <button
            type="button"
            className="button-primary"
            onClick={() => {
              onApply(draft)
              onClose()
            }}
          >
            <Icon name="check" size={15} strokeWidth={2.2} />
            应用转场
          </button>
        </footer>
      </section>
    </div>
  )
}
