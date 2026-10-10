/**
 * screen-buddy — renderer entry point
 * Mounts the React app into the #root div.
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import SettingsApp from './SettingsApp'
import BubbleApp from './BubbleApp'
import './index.css'

if (window.location.hash === '#bubbles') {
  document.title = 'screen-buddy-bubbles'
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {window.location.hash === '#settings' ? <SettingsApp /> : window.location.hash === '#bubbles' ? <BubbleApp /> : <App />}
  </React.StrictMode>
)
