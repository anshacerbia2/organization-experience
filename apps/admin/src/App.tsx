import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useState, type ReactElement } from 'react';

import { createQueryClient } from './api/query';
import { createAppRouter } from './router';
import { ThemeRoot } from './ui';

// App holds the theme root, the server state cache and the router. Each mount has its own, so nothing a previous
// session read survives into the next.
export function App(): ReactElement {
  const [client] = useState(createQueryClient);
  const [router] = useState(createAppRouter);
  return (
    <ThemeRoot>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeRoot>
  );
}
