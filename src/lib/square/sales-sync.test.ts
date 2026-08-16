import { describe, expect, it } from 'vitest'

import { computeSyncSince } from './sales-sync'

/**
 * MOK-186 — the lookback floor decides how much a sales-sync run pulls. The prod 504 came from a
 * first run with no watermark pulling ALL Square history; the floor now caps a first run to the
 * start of today (UTC) and never returns undefined (which is what triggered the unbounded pull).
 */
describe('computeSyncSince (MOK-186)', () => {
  it('resumes 60s before a prior watermark (dedup covers the overlap)', () => {
    const now = new Date('2026-08-16T08:00:00.000Z')
    expect(computeSyncSince('2026-08-15T18:30:00.000Z', now)).toBe('2026-08-15T18:29:00.000Z')
  })

  it('floors to the start of the current UTC day when there is no prior run (null)', () => {
    const now = new Date('2026-08-16T08:00:00.000Z')
    expect(computeSyncSince(null, now)).toBe('2026-08-16T00:00:00.000Z')
  })

  it('treats undefined like null — first run starts at the beginning of today', () => {
    const now = new Date('2026-08-16T23:59:59.000Z')
    expect(computeSyncSince(undefined, now)).toBe('2026-08-16T00:00:00.000Z')
  })

  it('never returns undefined (an undefined floor is what pulled all history)', () => {
    expect(typeof computeSyncSince(null, new Date('2026-01-01T00:00:00.000Z'))).toBe('string')
  })
})
