import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach( () => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.history.replaceState( {}, '', '/' )
} )
