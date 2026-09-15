import { lazy, Suspense } from 'react'
import { BrowserRouter, Outlet, Route, Routes } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import { AuthProvider } from '../auth/AuthProvider'
import { LettersProvider } from '../hooks/LettersProvider'
import { RequireAuth } from '../components/RequireAuth'
import { Layout } from '../components/Layout'
import NotFound from '../routes/NotFound'

// Split so a stranger following a link from a message downloads the letter and
// little else, rather than the whole app — auth, compose, archive and both
// modals — to read one letter once. The signed-in routes stay eager: those two
// open the app and stay in it, so splitting them would buy nothing.
const PublicLetter = lazy(() => import('../routes/PublicLetter'))

// The app's bulk — and framer-motion with it — belongs behind the chrome. A
// stranger opening a shared link should not download compose, archive and two
// modals to read one letter.
const Inbox = lazy(() => import('../routes/Inbox'))
const Compose = lazy(() => import('../routes/Compose'))
const Archive = lazy(() => import('../routes/Archive'))
const AuthScreen = lazy(() => import('../routes/AuthScreen'))
const SetupProfile = lazy(() => import('../routes/SetupProfile'))
const JoinPartner = lazy(() => import('../routes/JoinPartner'))
const Settings = lazy(() => import('../routes/Settings'))
const Chapters = lazy(() => import('../routes/Chapters'))
const Chapter = lazy(() => import('../routes/Chapter'))

/**
 * Wraps every route that belongs to the signed-in app in the shared chrome.
 *
 * MotionConfig lives HERE rather than around the whole tree so framer-motion
 * loads only for the routes that animate. Nothing outside this chrome uses it:
 * PublicLetter, NotFound and PaperTexture are all motion-free. One Suspense
 * covers all six lazy routes rather than one boundary each.
 */
function AppChrome() {
  return (
    <MotionConfig reducedMotion="user">
      <LettersProvider>
        <Layout>
          <Suspense
            fallback={<p className="py-20 text-center font-ui text-sm text-ink-muted">One moment…</p>}
          >
            <Outlet />
          </Suspense>
        </Layout>
      </LettersProvider>
    </MotionConfig>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* A stranger following a link from WhatsApp gets a letter, not
              an app: no header, no nav, nothing to sign into. Outside
              RequireAuth AND outside Layout. */}
          <Route
            path="/letter/:slug"
            element={
              <Suspense
                fallback={
                  <div className="flex min-h-screen items-center justify-center bg-paper-app">
                    <p className="font-ui text-sm text-ink-muted">One moment…</p>
                  </div>
                }
              >
                <PublicLetter />
              </Suspense>
            }
          />
          <Route path="/letter" element={<NotFound />} />
          <Route path="*" element={<NotFound />} />

          <Route element={<AppChrome />}>
            <Route path="/auth" element={<AuthScreen />} />
            <Route
              path="/setup"
              element={
                <RequireAuth>
                  <SetupProfile />
                </RequireAuth>
              }
            />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <Inbox />
                </RequireAuth>
              }
            />
            <Route
              path="/compose"
              element={
                <RequireAuth>
                  <Compose />
                </RequireAuth>
              }
            />
            <Route
              path="/archive"
              element={
                <RequireAuth>
                  <Archive />
                </RequireAuth>
              }
            />
            <Route
              path="/join/:inviteCode"
              element={
                <RequireAuth>
                  <JoinPartner />
                </RequireAuth>
              }
            />
            <Route
              path="/settings"
              element={
                <RequireAuth>
                  <Settings />
                </RequireAuth>
              }
            />
            <Route
              path="/chapters"
              element={
                <RequireAuth>
                  <Chapters />
                </RequireAuth>
              }
            />
            <Route
              path="/chapters/:bondId"
              element={
                <RequireAuth>
                  <Chapter />
                </RequireAuth>
              }
            />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
