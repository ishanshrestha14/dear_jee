import { useNavigate } from 'react-router-dom'
import { ComposeLetter } from '../components/ComposeLetter'
import { useLetters } from '../hooks/useLetters'

export default function Compose() {
  const { partnerName, loading, sendLetter } = useLetters()
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
