import { BrowserRouter } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { PaperTexture } from '../design/PaperTexture'

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <PaperTexture className="mx-auto max-w-[600px] p-10">
          <p className="font-letter text-lg leading-relaxed text-ink-letter">
            The texture should be felt more than seen.
          </p>
          <p className="mt-8 text-right font-hand text-3xl text-ink-ui">With love, Jee</p>
        </PaperTexture>
      </Layout>
    </BrowserRouter>
  )
}
