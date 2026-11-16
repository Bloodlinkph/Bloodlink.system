import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import GlobalLoading from './components/GlobalLoading.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <GlobalLoading />
  </StrictMode>,
)
