import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@talisham/ui/tokens.css';
import '@talisham/ui/base.css';
import './app.css';
import App from './App.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);
