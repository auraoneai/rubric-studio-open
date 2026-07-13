import React from 'react';
import ReactDOM from 'react-dom/client';
import { installOfficialStyleSheet } from '@auraone/proofline-oss';
import { App } from './App';
import '@auraone/proofline-oss/styles.css';
import '@auraone/aura-ide-kit/styles.css';
import './styles.css';
import './redesign.css';

installOfficialStyleSheet(import.meta.env.VITE_AURAONE_OFFICIAL_STYLE_URL);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
