import { useEffect, useRef } from 'react'
import { paintArtwork } from './artwork'

export default function ShotArt({ art, label, className = '' }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    paintArtwork(ctx, art, canvas.width, canvas.height)
  }, [art])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width="960"
      height="540"
      role="img"
      aria-label={label}
    />
  )
}
