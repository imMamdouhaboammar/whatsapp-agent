import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import resetCss from '@astryxdesign/core/reset.css?url'
import astryxCss from '@astryxdesign/core/astryx.css?url'
import themeCss from '@astryxdesign/theme-neutral/theme.css?url'
import appCss from './index.css?url'
import { App } from './App.tsx'
import { LocaleProvider } from './i18n'
import { OwnerAccessGate } from './components/OwnerAccessGate'
import { Theme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'

const root = document.getElementById('root')
if (!root) throw new Error('Missing application root')

createRoot(root).render(
  <StrictMode>
    {[resetCss, astryxCss, themeCss, appCss].map((href) => (
      <link key={href} rel="stylesheet" href={href} precedence="app" />
    ))}
    <Theme theme={neutralTheme}>
      <LocaleProvider>
        <OwnerAccessGate>
          <App />
        </OwnerAccessGate>
      </LocaleProvider>
    </Theme>
  </StrictMode>,
)
