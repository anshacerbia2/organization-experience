import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useState, type ReactElement } from 'react';

import { createQueryClient } from './api/query';
import { createAppRouter } from './router';

// App holds the server state cache and the router. Each mount has its own, so nothing a previous
// session read survives into the next.
export function App(): ReactElement {
  const [client] = useState(createQueryClient);
  const [router] = useState(createAppRouter);
  return (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
