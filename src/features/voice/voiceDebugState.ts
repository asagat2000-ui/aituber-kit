/**
 * 実機で状態を見るための小さな記録。
 * ?voiceDebug=1 のときだけ画面に出す。
 */
export type VoiceDebugSnapshot = {
  mic: boolean
  standby: boolean
  restarts: number
  lastEvent: string
  lastText: string
  error: string
}

export const voiceDebug: VoiceDebugSnapshot = {
  mic: false,
  standby: false,
  restarts: 0,
  lastEvent: '-',
  lastText: '',
  error: '',
}

export function updateVoiceDebug(patch: Partial<VoiceDebugSnapshot>): void {
  Object.assign(voiceDebug, patch)
}
