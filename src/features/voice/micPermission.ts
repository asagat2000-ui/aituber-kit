/**
 * マイク許可の結果を使い回す。
 *
 * iOS では getUserMedia のたびに音声デバイスを開き直すため、
 * 認識の再起動のたびに呼ぶと描画が固まる（アバターがカクつく）。
 * 一度許可されたら、そのセッションでは再確認しない。
 */
let granted = false

export function isMicPermissionGranted(): boolean {
  return granted
}

export function markMicPermissionGranted(): void {
  granted = true
}

export function resetMicPermissionForTest(): void {
  granted = false
}
