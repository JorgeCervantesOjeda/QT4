import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ErrorChecklistModal from './ErrorChecklistModal'

vi.mock( '../giphy/GiphyProvider', () => ( {
  GiphyInline: () => null,
} ) )

vi.mock( '../lib/errorMonitor', () => ( {
  reportUserVisibleError: vi.fn(),
} ) )

describe( 'ErrorChecklistModal', () => {
  it( 'hides the admin report button for normal create issue validation', () => {
    render(
      <ErrorChecklistModal
        error="To create an issue, the version must be in active review time or grace, you must be the author, leader, or reviewer, and the title cannot be empty."
        checklist={[
          { label: '(a version is selected)', ok: true },
          { label: '(issue title is provided)', ok: false },
        ]}
        onClose={() => undefined}
      />,
    )

    expect( screen.queryByRole( 'button', { name: 'Report to admin' } ) ).toBeNull()
    expect( screen.getByRole( 'button', { name: 'Close' } ) ).toBeTruthy()
  } )

  it( 'keeps the admin report button for real visible failures', () => {
    render(
      <ErrorChecklistModal
        error="Project documents failed at latest-versions: Missing or insufficient permissions."
        checklist={[
          { label: '(project is selected)', ok: true },
          { label: '(network connection is available)', ok: true },
        ]}
        onClose={() => undefined}
      />,
    )

    expect( screen.getByRole( 'button', { name: 'Report to admin' } ) ).toBeTruthy()
  } )

  it( 'keeps the admin report button for create issue failures after validation passes', () => {
    render(
      <ErrorChecklistModal
        error="Issue create failed: Missing or insufficient permissions."
        checklist={[
          { label: '(a version is selected)', ok: true },
          { label: '(issue title is provided)', ok: true },
        ]}
        onClose={() => undefined}
      />,
    )

    expect( screen.getByRole( 'button', { name: 'Report to admin' } ) ).toBeTruthy()
  } )
} )
