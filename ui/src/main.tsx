import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { LocaleProvider } from './i18n'
import { OwnerAccessGate } from './components/OwnerAccessGate'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleProvider>
      <OwnerAccessGate>
        <App />
      </OwnerAccessGate>
    </LocaleProvider>
  </StrictMode>,
)
