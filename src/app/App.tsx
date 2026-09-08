import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import { Layout } from '../components/Layout'
import Inbox from '../routes/Inbox'
import Compose from '../routes/Compose'

export default function App() {
  return (
    <BrowserRouter>
      <MotionConfig reducedMotion="user">
        <Layout>
          <Routes>
            <Route path="/" element={<Inbox />} />
            <Route path="/compose" element={<Compose />} />
          </Routes>
        </Layout>
      </MotionConfig>
    </BrowserRouter>
  )
}
