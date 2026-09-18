import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import { getSession, onAuthStateChange } from '../services';

export interface SessionState {
  session: Session | null;
  /**
   * True until the persisted session has been read from encrypted storage.
   *
   * The navigator must wait for this: rendering the auth stack while it is
   * still unknown would flash the sign-in screen at an already-signed-in user
   * on every cold start.
   */
  loading: boolean;
}

/**
 * The single source of truth for "is someone signed in".
 *
 * Reads the persisted session once on mount, then follows
 * `onAuthStateChange` for sign-in, sign-out and token refresh. Nothing else in
 * the app should call `getSession` directly for routing decisions.
 */
export const useSession = (): SessionState => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    getSession()
      .then((initial) => {
        if (active) {
          setSession(initial);
          setLoading(false);
        }
      })
      .catch(() => {
        // A decryption failure or wiped keychain is indistinguishable from
        // "not signed in" as far as routing is concerned.
        if (active) {
          setSession(null);
          setLoading(false);
        }
      });

    const subscription = onAuthStateChange((_event, next) => {
      if (active) {
        setSession(next);
        setLoading(false);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return { session, loading };
};
