import { test, expect } from '@playwright/test'
import { canLoadNextMessagePage } from '../lib/message-preview-pagination'

test.describe('Message preview pagination (issue #493)', () => {
  test('continues past the currently cached page boundary', () => {
    expect(canLoadNextMessagePage(11, 11, true)).toBe(true)
    expect(canLoadNextMessagePage(1, 2, false)).toBe(true)
    expect(canLoadNextMessagePage(2, 2, false)).toBe(false)
  })
})
