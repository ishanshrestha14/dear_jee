import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import { AuthProvider } from '../auth/AuthProvider'
import { RequireAuth } from '../components/RequireAuth'
import { Layout } from '../components/Layout'
import Inbox from '../routes/Inbox'
import Compose from '../routes/Compose'
import AuthScreen from '../routes/AuthScreen'

export default function App() {
  return (
    <BrowserRouter>
      <MotionConfig reducedMotion="user">
        <AuthProvider>
          <Layout>
            <Routes>
              <Route path="/auth" element={<AuthScreen />} />
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
            </Routes>
          </Layout>
        </AuthProvider>
      </MotionConfig>
    </BrowserRouter>
  )
}
