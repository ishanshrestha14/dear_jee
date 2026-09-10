import { BrowserRouter, Outlet, Route, Routes } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import { AuthProvider } from '../auth/AuthProvider'
import { RequireAuth } from '../components/RequireAuth'
import { Layout } from '../components/Layout'
import Inbox from '../routes/Inbox'
import Compose from '../routes/Compose'
import Archive from '../routes/Archive'
import AuthScreen from '../routes/AuthScreen'
import SetupProfile from '../routes/SetupProfile'
import JoinPartner from '../routes/JoinPartner'
import PublicLetter from '../routes/PublicLetter'
import NotFound from '../routes/NotFound'

/** Wraps every route that belongs to the signed-in app in the shared chrome. */
function AppChrome() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <MotionConfig reducedMotion="user">
        <AuthProvider>
          <Routes>
            {/* A stranger following a link from WhatsApp gets a letter, not
                an app: no header, no nav, nothing to sign into. Outside
                RequireAuth AND outside Layout. */}
            <Route path="/letter/:slug" element={<PublicLetter />} />
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
            </Route>
          </Routes>
        </AuthProvider>
      </MotionConfig>
    </BrowserRouter>
  )
}
