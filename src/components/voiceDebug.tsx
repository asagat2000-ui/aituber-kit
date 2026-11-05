import { useEffect, useState } from 'react'
import { voiceDebug } from '@/features/voice/voiceDebugState'

/**
 * ?voiceDebug=1 のときだけ出る状態表示。
 * 実機のコンソールが見られない場所用。
 */
const VoiceDebug = () => {
  const [enabled, setEnabled] = useState(false)
  const [, force] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const on =
      new URLSearchParams(window.location.search).get('voiceDebug') === '1'
    setEnabled(on)
    if (!on) return
    const id = setInterval(() => force((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [])

  if (!enabled) return null

  return (
    <div
      style={{
        position: 'fixed',
        left: 6,
        bottom: 6,
        zIndex: 99999,
        background: 'rgba(0,0,0,0.72)',
        color: '#0f0',
        fontFamily: 'monospace',
        fontSize: 10,
        lineHeight: 1.5,
        padding: '4px 6px',
        borderRadius: 4,
        pointerEvents: 'none',
        maxWidth: '70vw',
        wordBreak: 'break-all',
      }}
    >
      <div>
        mic:{voiceDebug.mic ? 'ON' : 'off'} 待機:
        {voiceDebug.standby ? 'ON' : 'off'} 再起動:{voiceDebug.restarts}
      </div>
      <div>ev:{voiceDebug.lastEvent}</div>
      <div>txt:{voiceDebug.lastText || '-'}</div>
      {voiceDebug.error ? <div>err:{voiceDebug.error}</div> : null}
    </div>
  )
}

export default VoiceDebug
