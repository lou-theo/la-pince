import './styles/global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { captureInstallPrompt } from './install/platform.ts';
import { startTheme } from './screens/theme.ts';
import { createApiClient } from './sync/client.ts';

captureInstallPrompt();
startTheme();

const root = document.getElementById('root');
if (root === null) {
  throw new Error('index.html has no #root');
}
createRoot(root).render(
  <StrictMode>
    <App client={createApiClient(fetch)} />
  </StrictMode>,
);
