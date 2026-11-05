import {
  isMicPermissionGranted,
  markMicPermissionGranted,
  resetMicPermissionForTest,
} from '@/features/voice/micPermission'

describe('マイク許可の使い回し', () => {
  beforeEach(() => resetMicPermissionForTest())

  it('初期状態は未許可', () => {
    expect(isMicPermissionGranted()).toBe(false)
  })

  it('一度許可したら記憶される', () => {
    markMicPermissionGranted()
    expect(isMicPermissionGranted()).toBe(true)
  })

  it('リセットで未許可に戻る', () => {
    markMicPermissionGranted()
    resetMicPermissionForTest()
    expect(isMicPermissionGranted()).toBe(false)
  })
})
