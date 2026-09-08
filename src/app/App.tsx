import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import { AuthProvider } from '../auth/AuthProvider'
import { RequireAuth } from '../components/RequireAuth'
import { Layout } from '../components/Layout'
import Inbox from '../routes/Inbox'
import Compose from '../routes/Compose'
import AuthScreen from '../routes/AuthScreen'
import SetupProfile from '../routes/SetupProfile'
import JoinPartner from '../routes/JoinPartner'

export default function App() {
  return (
    <BrowserRouter>
      <MotionConfig reducedMotion="user">
        <AuthProvider>
          <Layout>
            <Routes>
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
                path="/join/:inviteCode"
                element={
                  <RequireAuth>
                    <JoinPartner />
                  </RequireAuth>
                }
              />
            </Routes>
          </Layout>
        </AuthProvider>
      </MotionConfig>
    </BrowserRouter>
  )
}
