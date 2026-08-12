import { useNavigate } from 'react-router-dom'

export function useNavBack(fallback: string) {
  const navigate = useNavigate()
  return () => {
    // React Router sets history.state.idx; 0 means we are at the start of the session
    if ((window.history.state as { idx?: number } | null)?.idx) {
      navigate(-1)
    } else {
      navigate(fallback, { replace: true })
    }
  }
}
