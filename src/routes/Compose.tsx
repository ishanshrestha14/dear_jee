import { useNavigate } from 'react-router-dom'
import { ComposeLetter } from '../components/ComposeLetter'
import { useLetters } from '../hooks/useLetters'

export default function Compose() {
  const { partnerName, sendLetter } = useLetters()
  const navigate = useNavigate()

  return (
    <ComposeLetter
      partnerName={partnerName}
      onSend={async (message) => {
        const result = await sendLetter(message)
        if (result.ok) navigate('/')
        return result
      }}
    />
  )
}
