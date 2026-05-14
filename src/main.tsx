import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './reference-fonts.css';
import './styles.css';
import './redesign.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
