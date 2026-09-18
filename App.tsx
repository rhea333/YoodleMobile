import './global.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootNavigator } from './src/navigation';

/**
 * Created once at module scope, not inside the component: a QueryClient
 * rebuilt on every render would discard the cache each time.
 *
 * `retry: 1` rather than the default 3 — a failed profile read is usually an
 * RLS denial or a missing session, and retrying those just delays the error
 * the user needs to see.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <RootNavigator />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
