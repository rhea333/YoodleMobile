import './global.css';

import { StripeProvider } from '@stripe/stripe-react-native';
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

/**
 * The PUBLISHABLE key, and only ever the publishable key.
 *
 * It is designed to be public: it lets Stripe's SDK collect a card and confirm
 * a PaymentIntent we hand it a client secret for. It cannot capture, transfer,
 * refund or read anything. The SECRET key lives in Supabase Edge Function
 * secrets and never enters this bundle — see SECURITY.md.
 */
const stripePublishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <StripeProvider
        // Lets Stripe return to the app after a 3D Secure challenge, which is
        // handled in a browser or bank app rather than in-process.
        urlScheme="yoodle"
        publishableKey={stripePublishableKey}
      >
        <SafeAreaProvider>
          <RootNavigator />
        </SafeAreaProvider>
      </StripeProvider>
    </QueryClientProvider>
  );
}
