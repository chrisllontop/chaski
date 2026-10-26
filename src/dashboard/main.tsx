import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { setNonce } from 'get-nonce';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyTheme } from './lib/theme';
import { router } from './router';
import './styles.css';

// The CSP rules out an inline script in the shell, so the theme is set here,
// before the first render.
applyTheme();

// The styles Radix writes at runtime carry the nonce the server put in the
// shell's CSP; get-nonce is where Radix reads it from.
const nonce = document.querySelector<HTMLMetaElement>('meta[name="chaski-nonce"]')?.content;
if (nonce) setNonce(nonce);

const root = document.getElementById('root');
if (!root) {
  throw new Error('The dashboard shell has no #root element.');
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true } },
});

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
