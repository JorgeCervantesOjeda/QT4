// src/lib/slowUiAction.test.ts: Verifies slow non-modal UI action measurement and reporting.
import { describe, expect, it, vi } from 'vitest'
import { measureSlowUiAction } from './slowUiAction'

describe( 'lib/slowUiAction', () => {
  it( 'does not report non-modal actions at or below one second', async () => {
    const reportSlowUiAction = vi.fn()
    const nowMs = vi.fn()
      .mockReturnValueOnce( 1000 )
      .mockReturnValueOnce( 2000 )

    const result = await measureSlowUiAction(
      { action: 'review.explainIssue', page: 'Document Versions' },
      async () => 'done',
      { nowMs, reportSlowUiAction },
    )

    expect( result ).toBe( 'done' )
    expect( reportSlowUiAction ).not.toHaveBeenCalled()
  } )

  it( 'reports non-modal actions that take more than one second', async () => {
    const reportSlowUiAction = vi.fn()
    const nowMs = vi.fn()
      .mockReturnValueOnce( 5000 )
      .mockReturnValueOnce( 6125 )

    await measureSlowUiAction(
      {
        action: 'review.explainComment',
        page: 'Document Versions',
        hasModal: false,
        userId: 'user-1',
        projectId: 'project-1',
        docId: 'doc-1',
        versionId: 'version-1',
        threadId: 'thread-1',
      },
      async () => undefined,
      { nowMs, reportSlowUiAction },
    )

    expect( reportSlowUiAction ).toHaveBeenCalledWith( {
      action: 'review.explainComment',
      page: 'Document Versions',
      hasModal: false,
      route: '',
      userId: 'user-1',
      projectId: 'project-1',
      docId: 'doc-1',
      versionId: 'version-1',
      threadId: 'thread-1',
      durationMs: 1125,
      thresholdMs: 1000,
      startedAtMs: 5000,
      endedAtMs: 6125,
    } )
  } )

  it( 'does not report actions that already use a modal', async () => {
    const reportSlowUiAction = vi.fn()
    const nowMs = vi.fn()
      .mockReturnValueOnce( 1000 )
      .mockReturnValueOnce( 3001 )

    await measureSlowUiAction(
      { action: 'dashboard.analyzeUrgency', page: 'Dashboard', hasModal: true },
      async () => undefined,
      { nowMs, reportSlowUiAction },
    )

    expect( reportSlowUiAction ).not.toHaveBeenCalled()
  } )

  it( 'preserves operation failures even when measuring', async () => {
    const reportSlowUiAction = vi.fn()
    const nowMs = vi.fn()
      .mockReturnValueOnce( 1000 )
      .mockReturnValueOnce( 2500 )

    await expect(
      measureSlowUiAction(
        { action: 'review.improveWriting', page: 'Document Versions' },
        async () => {
          throw new Error( 'AI failed' )
        },
        { nowMs, reportSlowUiAction },
      ),
    ).rejects.toThrow( 'AI failed' )

    expect( reportSlowUiAction ).toHaveBeenCalledTimes( 1 )
  } )

  it( 'warns instead of failing the user action when reporting fails', async () => {
    const warnSpy = vi.spyOn( console, 'warn' ).mockImplementation( () => undefined )
    const reportSlowUiAction = vi.fn().mockRejectedValue( new Error( 'write denied' ) )
    const nowMs = vi.fn()
      .mockReturnValueOnce( 1000 )
      .mockReturnValueOnce( 2500 )

    await expect(
      measureSlowUiAction(
        { action: 'review.explainIssue', page: 'Document Versions' },
        async () => 'ok',
        { nowMs, reportSlowUiAction },
      ),
    ).resolves.toBe( 'ok' )
    await new Promise<void>( (resolve) => {
      setTimeout( resolve, 0 )
    } )

    expect( warnSpy ).toHaveBeenCalledWith(
      'Slow UI action reporting failed:',
      expect.any( Error ),
    )
    warnSpy.mockRestore()
  } )

  it( 'warns instead of failing when reporting throws synchronously', async () => {
    const warnSpy = vi.spyOn( console, 'warn' ).mockImplementation( () => undefined )
    const reportSlowUiAction = vi.fn( () => {
      throw new Error( 'sync write denied' )
    } )
    const nowMs = vi.fn()
      .mockReturnValueOnce( 1000 )
      .mockReturnValueOnce( 2500 )

    await expect(
      measureSlowUiAction(
        { action: 'review.explainIssue', page: 'Document Versions' },
        async () => 'ok',
        { nowMs, reportSlowUiAction },
      ),
    ).resolves.toBe( 'ok' )

    expect( warnSpy ).toHaveBeenCalledWith(
      'Slow UI action reporting failed:',
      expect.any( Error ),
    )
    warnSpy.mockRestore()
  } )
} )
