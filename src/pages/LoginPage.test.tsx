import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const {
  sendPasswordResetEmailMock,
  signInWithEmailAndPasswordMock,
  setPersistenceMock,
  reportAbnormalErrorMock,
} = vi.hoisted( () => ( {
  sendPasswordResetEmailMock: vi.fn(),
  signInWithEmailAndPasswordMock: vi.fn(),
  setPersistenceMock: vi.fn(),
  reportAbnormalErrorMock: vi.fn(),
} ) )

vi.mock( 'firebase/auth', () => ( {
  browserLocalPersistence: { name: 'browserLocalPersistence' },
  sendPasswordResetEmail: sendPasswordResetEmailMock,
  setPersistence: setPersistenceMock,
  signInWithEmailAndPassword: signInWithEmailAndPasswordMock,
} ) )

vi.mock( '../auth/useAuth', () => ( {
  useAuth: () => ( {
    user: null,
    loading: false,
  } ),
} ) )

vi.mock( '../lib/errorMonitor', () => ( {
  reportAbnormalError: reportAbnormalErrorMock,
} ) )

vi.mock( '../lib/firebase', () => ( {
  auth: { currentUser: null },
} ) )

vi.mock( '../giphy/GiphyProvider', () => ( {
  GiphyInline: () => null,
} ) )

import LoginPage from './LoginPage'

const renderLoginPage = (entry: string = '/login') => {
  render(
    <MemoryRouter initialEntries={[ entry ]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/app" element={<div>Dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe( 'pages/LoginPage password reset', () => {
  afterEach( () => {
    vi.clearAllMocks()
  } )

  it( 'shows a validation error when the email field is empty', async () => {
    renderLoginPage()

    fireEvent.click( screen.getByRole( 'button', { name: 'Reset password' } ) )

    expect( await screen.findByText( 'Enter your email to request a password reset.' ) ).toBeTruthy()
    expect( sendPasswordResetEmailMock ).not.toHaveBeenCalled()
  } )

  it( 'shows a validation error when the email format is invalid', async () => {
    renderLoginPage()

    fireEvent.change( screen.getByLabelText( 'Email' ), {
      target: { value: 'not-an-email' },
    } )
    fireEvent.click( screen.getByRole( 'button', { name: 'Reset password' } ) )

    expect(
      await screen.findByText( 'Enter a valid email address before requesting a password reset.' ),
    ).toBeTruthy()
    expect( sendPasswordResetEmailMock ).not.toHaveBeenCalled()
  } )

  it( 'shows a success notice when the password reset request succeeds', async () => {
    sendPasswordResetEmailMock.mockResolvedValueOnce( undefined )
    renderLoginPage()

    fireEvent.change( screen.getByLabelText( 'Email' ), {
      target: { value: 'member@example.com' },
    } )
    fireEvent.click( screen.getByRole( 'button', { name: 'Reset password' } ) )

    expect(
      await screen.findByText( 'Password reset email sent to member@example.com. Check your inbox.' ),
    ).toBeTruthy()
    expect( sendPasswordResetEmailMock ).toHaveBeenCalledWith(
      expect.anything(),
      'member@example.com',
    )
  } )

  it( 'shows the backend user-not-found error for an unknown email', async () => {
    sendPasswordResetEmailMock.mockRejectedValueOnce( new Error( 'No user found for that email address.' ) )
    renderLoginPage()

    fireEvent.change( screen.getByLabelText( 'Email' ), {
      target: { value: 'missing-user@example.com' },
    } )
    fireEvent.click( screen.getByRole( 'button', { name: 'Reset password' } ) )

    expect( await screen.findByText( 'No user found for that email address.' ) ).toBeTruthy()
    expect( reportAbnormalErrorMock ).toHaveBeenCalledWith(
      expect.objectContaining( {
        action: 'login.passwordReset',
        source: 'auth',
      } ),
    )
  } )

  it( 'shows a generic backend failure during password reset', async () => {
    sendPasswordResetEmailMock.mockRejectedValueOnce( new Error( 'Mail service unavailable.' ) )
    reportAbnormalErrorMock.mockResolvedValueOnce( undefined )
    renderLoginPage()

    fireEvent.change( screen.getByLabelText( 'Email' ), {
      target: { value: 'member@example.com' },
    } )
    fireEvent.click( screen.getByRole( 'button', { name: 'Reset password' } ) )

    expect( await screen.findByText( 'Mail service unavailable.' ) ).toBeTruthy()
    await waitFor( () => {
      expect( reportAbnormalErrorMock ).toHaveBeenCalledWith(
        expect.objectContaining( {
          action: 'login.passwordReset',
          source: 'auth',
        } ),
      )
    } )
  } )
} )
