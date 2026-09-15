import { createContext, useContext, type ReactNode } from 'react'
import { useLetters as useLettersState, type UseLetters } from './useLetters'

const LettersContext = createContext<UseLetters | null>(null)

/**
 * Mounted once, above the Outlet, so switching between Inbox, Compose and
 * Archive doesn't unmount-and-remount useLetters — which was refetching
 * from scratch on every navigation, including Cancel back to the inbox
 * right after Compose had just come from there. One fetch per sign-in,
 * not one per route visit.
 */
export function LettersProvider({ children }: { children: ReactNode }) {
  const value = useLettersState()
  return <LettersContext.Provider value={value}>{children}</LettersContext.Provider>
}

export function useLettersContext(): UseLetters {
  const context = useContext(LettersContext)
  if (context === null) {
    throw new Error('useLettersContext must be used within a LettersProvider')
  }
  return context
}
