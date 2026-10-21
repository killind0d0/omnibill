import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { BootGate } from './features/access';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import './index.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <BootGate>
          <App />
        </BootGate>
      </ErrorBoundary>
    </React.StrictMode>
  );
}
