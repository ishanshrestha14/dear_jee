import { useNavigate } from 'react-router-dom'
import { ComposeLetter } from '../components/ComposeLetter'
import { useLettersContext } from '../hooks/LettersProvider'

export default function Compose() {
  const { partnerName, loading, sendLetter } = useLettersContext()
  const navigate = useNavigate()

  return (
    <ComposeLetter
      partnerName={partnerName}
      disabled={loading}
      onCancel={() => navigate('/')}
      onSend={async (message, salutation, bodyFont) => {
        const result = await sendLetter(message, salutation, bodyFont)
        if (result.ok) navigate('/')
        return result
      }}
    />
  )
}
