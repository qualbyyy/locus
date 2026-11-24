import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { preloadBuiltinFonts } from './core/fonts';
import { App } from './App';
import './index.css';

void preloadBuiltinFonts();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
