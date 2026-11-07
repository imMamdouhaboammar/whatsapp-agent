import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@astryxdesign/core/reset.css'
import '@astryxdesign/core/astryx.css'
import '@astryxdesign/theme-neutral/theme.css'
import './index.css'
import App from './App.tsx'
import { LocaleProvider } from './i18n'
import { OwnerAccessGate } from './components/OwnerAccessGate'
import { Theme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Theme theme={neutralTheme}>
      <LocaleProvider>
        <OwnerAccessGate>
          <App />
        </OwnerAccessGate>
      </LocaleProvider>
    </Theme>
  </StrictMode>,
)
