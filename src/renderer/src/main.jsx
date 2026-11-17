/**
 * screen-buddy — renderer entry point
 * Mounts the React app into the #root div.
 */

import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'

const App = React.lazy(() => import('./App'))
const SettingsApp = React.lazy(() => import('./SettingsApp'))
const BubbleApp = React.lazy(() => import('./BubbleApp'))

let Component = App
if (window.location.hash === '#bubbles') {
  document.title = 'screen-buddy-bubbles'
  Component = BubbleApp
} else if (window.location.hash === '#settings') {
  document.title = 'screen-buddy-settings'
  Component = SettingsApp
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      <Component />
    </Suspense>
  </React.StrictMode>
)
