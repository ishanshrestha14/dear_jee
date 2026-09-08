import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from '../components/Layout'
import Inbox from '../routes/Inbox'
import Compose from '../routes/Compose'

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Inbox />} />
          <Route path="/compose" element={<Compose />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
