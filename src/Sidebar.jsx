import Icon from './icons'
import { totalDuration } from './data'

function MiniOrder({ sequence, revisedId }) {
  return (
    <div className="mini-order">
      {sequence.map((id, index) => (
        <span key={id} className={id === revisedId ? 'is-moved' : ''}>
          {id}
          {index < sequence.length - 1 && <i>·</i>}
        </span>
      ))}
    </div>
  )
}

export default function Sidebar({
  sequence,
  conflict,
  revision,
  onReset,
  onFocusConflict,
  onExport,
  exporting,
  exportReady,
  shotsById,
}) {
  const lookupShot = (id) => shotsById[id]
  const total = totalDuration(sequence, lookupShot)
  const firstConflict = conflict.directionConflicts[0]
  const maxDuration = Math.max(...sequence.map((id) => lookupShot(id).duration))

  return (
    <aside className="sidebar">
      <section className="side-card runtime-card">
        <div className="side-card-head">
          <span className="eyebrow">RUNTIME / 时长</span>
          <span className="live-pill"><i /> LIVE</span>
        </div>
        <div className="runtime-number">
          00:<strong>{total.toFixed(1).padStart(4, '0')}</strong>
        </div>
        <div className="runtime-meta">
          <span>6 SHOTS</span>
          <span>5 CONNECTIONS</span>
          <span>16:9</span>
        </div>
        <div className="runtime-meter" aria-label="各镜头时长占比">
          {sequence.map((id) => {
            const shot = lookupShot(id)
            return (
              <span
                key={id}
                className="meter-clip"
                style={{ flexGrow: shot.duration, background: shot.tone }}
                title={`${shot.id} · ${shot.duration.toFixed(1)}s`}
              >
                <span>{shot.id}</span>
              </span>
            )
          })}
        </div>
        <div className="runtime-scale">
          <span>0s</span>
          <span>{Math.round(total / 2)}s</span>
          <span>{total.toFixed(1)}s</span>
        </div>
      </section>

      <section className={`side-card check-card ${firstConflict ? 'check-card-error' : 'check-card-clear'}`}>
        <div className="side-card-head">
          <div>
            <span className="eyebrow">CONTINUITY / 连续性</span>
            <h2>方向检查</h2>
          </div>
          <span className={`check-badge ${firstConflict ? 'error' : 'clear'}`}>
            {firstConflict ? '01 ERROR' : 'CLEAR'}
          </span>
        </div>

        {firstConflict ? (
          <>
            <div className="axis-pair">
              <span className="axis-shot">
                <small>镜头</small>
                <strong>{firstConflict.from}</strong>
              </span>
              <span className="axis-arrow">
                <i />
                <Icon name="arrow" size={14} />
              </span>
              <span className="axis-shot">
                <small>镜头</small>
                <strong>{firstConflict.to}</strong>
              </span>
              <div className="axis-tags">
                <span>动作反转</span>
                <span>越轴</span>
              </div>
            </div>
            <p className="conflict-message">{firstConflict.message}</p>
            <div className="fix-note">
              <span>建议</span>
              <p>{firstConflict.suggestion}</p>
            </div>
            <button type="button" className="text-button" onClick={onFocusConflict}>
              定位冲突连接
              <Icon name="chevron" size={13} />
            </button>
          </>
        ) : (
          <div className="clear-state">
            <span className="clear-icon"><Icon name="check" size={18} strokeWidth={2.2} /></span>
            <div>
              <strong>相邻镜头方向连续</strong>
              <p>动作轴与视点连接均可正常阅读。</p>
            </div>
          </div>
        )}

        <div className="check-rule">
          <span className="rule-icon"><Icon name="eye" size={13} /></span>
          <div>
            <strong>视点连接</strong>
            <p>{firstConflict ? '侧面 → 背面 · 90° 视点变化' : '当前连接不超过 90° 视点变化'}</p>
          </div>
          <span className={`rule-state ${firstConflict ? 'warn' : 'ok'}`}>
            {firstConflict ? '注意' : '通过'}
          </span>
        </div>
      </section>

      <section className="side-card revision-card">
        <div className="side-card-head">
          <span className="eyebrow">REVISION / 修订</span>
          <span className="rev-number">#{revision.count.toString().padStart(2, '0')}</span>
        </div>
        <div className="revision-summary">
          <span className="move-icon"><Icon name="layers" size={15} /></span>
          <div>
            <strong>镜头 {revision.movedId} 已调整</strong>
            <p>{revision.detail}</p>
          </div>
          <button type="button" className="undo-button" onClick={onReset} title="恢复原始顺序">
            <Icon name="undo" size={14} />
          </button>
        </div>
        <div className="order-compare">
          <span>当前序列</span>
          <MiniOrder sequence={sequence} revisedId={revision.movedId} />
        </div>
        <div className="revision-tags">
          <span><i className="legend-dot same" /> 同轴</span>
          <span><i className="legend-dot neutral" /> 中性</span>
          <span><i className="legend-dot conflict" /> 反向</span>
        </div>
      </section>

      <section className="export-card">
        <div className="export-page">
          <span className="page-crop top-left" />
          <span className="page-crop top-right" />
          <span className="page-crop bottom-left" />
          <span className="page-crop bottom-right" />
          <span className="page-title">午夜快递</span>
          <div className="page-grid">
            {sequence.slice(0, 6).map((id, index) => (
              <span key={id} style={{ background: lookupShot(id).tone }}>
                {index + 1}
              </span>
            ))}
          </div>
          <span className="page-foot">STORYBOARD · A4</span>
        </div>
        <div className="export-copy">
          <span className="eyebrow">EXPORT / 输出</span>
          <h3>{exportReady ? '打印页已就绪' : 'PDF 风格分镜页'}</h3>
          <p>A4 · 300 DPI · 白底印刷版式</p>
          <button type="button" className="export-button" onClick={onExport} disabled={exporting}>
            <Icon name={exporting ? 'clock' : exportReady ? 'check' : 'download'} size={15} />
            {exporting ? '正在生成…' : exportReady ? '再次导出 PNG' : '导出 PNG'}
          </button>
        </div>
      </section>

      <div className="sidebar-foot">
        <span>PROJECT 04-A</span>
        <span>MAX {maxDuration.toFixed(1)}s / SHOT</span>
        <span>AUTO SAVED</span>
      </div>
    </aside>
  )
}
