import type { AuthChangeEvent, Session, Subscription, User } from '@supabase/supabase-js';

import { supabase } from './supabase';

/**
 * Email/password auth for Yoodle. Service functions only — screens land next
 * phase.
 *
 * Every function returns a discriminated result rather than throwing, so
 * callers handle failure explicitly and no Supabase error object leaks into a
 * component. Raw Supabase errors are deliberately not re-exposed: their
 * messages are not written for end users, and some distinguish "no such user"
 * from "wrong password", which is an account-enumeration hint.
 */

export interface AuthSuccess {
  ok: true;
  session: Session | null;
  user: User | null;
}

export interface AuthFailure {
  ok: false;
  /** Safe to show a user. */
  message: string;
  /** Stable code for branching in UI; `unknown` when Supabase gave us no code. */
  code: AuthErrorCode;
}

export type AuthResult = AuthSuccess | AuthFailure;

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_taken'
  | 'weak_password'
  | 'email_not_confirmed'
  | 'rate_limited'
  | 'network'
  | 'unknown';

export interface Credentials {
  email: string;
  password: string;
}

/**
 * Profile fields captured at sign-up.
 *
 * These are sent as `options.data`, land in `auth.users.raw_user_meta_data`,
 * and are materialised into `public.profiles` by the `on_auth_user_created`
 * trigger (migration 0008). That path is used instead of a client-side write
 * because it needs no session: if email confirmation is enabled, `signUp`
 * returns no session and an RLS-protected client write would be denied,
 * silently losing the name and postal code.
 *
 * The trigger treats this as untrusted input — it length-caps the name and
 * drops an invalid postal code rather than failing account creation.
 */
export interface SignUpProfile {
  displayName: string;
  /** Full Canadian postal code. The database derives and exposes only the FSA. */
  postalCode: string;
}

/**
 * Maps Supabase auth error codes onto our own codes and user-facing copy.
 *
 * `invalid_credentials` is deliberately vague about *which* half was wrong —
 * saying "no account with that email" would let anyone test whether an address
 * is registered.
 */
const describeError = (code: string | undefined, status: number | undefined): AuthFailure => {
  switch (code) {
    case 'invalid_credentials':
      return {
        ok: false,
        code: 'invalid_credentials',
        message: 'That email and password combination does not match an account.',
      };
    case 'user_already_exists':
    case 'email_exists':
      return {
        ok: false,
        code: 'email_taken',
        message: 'An account with that email already exists. Try signing in instead.',
      };
    case 'weak_password':
      return {
        ok: false,
        code: 'weak_password',
        message: 'Please choose a longer password — at least 8 characters.',
      };
    case 'email_not_confirmed':
      return {
        ok: false,
        code: 'email_not_confirmed',
        message: 'Please confirm your email address, then sign in.',
      };
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return {
        ok: false,
        code: 'rate_limited',
        message: 'Too many attempts. Please wait a moment and try again.',
      };
    default:
      if (status === undefined) {
        return {
          ok: false,
          code: 'network',
          message: 'Could not reach Yoodle. Check your connection and try again.',
        };
      }
      return { ok: false, code: 'unknown', message: 'Something went wrong. Please try again.' };
  }
};

/**
 * Creates an account.
 *
 * Note: when "Confirm email" is ON in the Supabase dashboard, this resolves
 * with `session === null` and no session is persisted — the user must confirm
 * by email first. Callers must handle that, not assume a signed-in state.
 */
export const signUpWithEmail = async (
  { email, password }: Credentials,
  profile: SignUpProfile,
): Promise<AuthResult> => {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      data: {
        display_name: profile.displayName.trim(),
        // Normalised to no-space uppercase; the trigger re-validates.
        postal_code: profile.postalCode.replace(/\s+/g, '').toUpperCase(),
      },
    },
  });

  if (error) {
    return describeError(error.code, error.status);
  }

  return { ok: true, session: data.session, user: data.user };
};

export const signInWithEmail = async ({ email, password }: Credentials): Promise<AuthResult> => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  if (error) {
    return describeError(error.code, error.status);
  }

  return { ok: true, session: data.session, user: data.user };
};

/** Clears the session locally and revokes it server-side. */
export const signOut = async (): Promise<{ ok: boolean; message?: string }> => {
  const { error } = await supabase.auth.signOut();
  if (error) {
    return { ok: false, message: 'Could not sign out cleanly. Please try again.' };
  }
  return { ok: true };
};

/** The persisted session, decrypted from storage. `null` when signed out. */
export const getSession = async (): Promise<Session | null> => {
  const { data } = await supabase.auth.getSession();
  return data.session;
};

/**
 * Prefer this over reading `session.user` when you need to be sure the user
 * still exists and the token is valid: it revalidates against the server,
 * whereas `getSession` trusts whatever is in local storage.
 */
export const getCurrentUser = async (): Promise<User | null> => {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    return null;
  }
  return data.user;
};

/**
 * Always reports success, even when Supabase reports an error.
 *
 * This is intentional: telling the caller that the address is unknown would
 * turn this endpoint into an account-enumeration oracle. The UI should say
 * "if that address has an account, we've sent a link" regardless.
 */
export const sendPasswordReset = async (email: string): Promise<{ ok: true }> => {
  await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
  return { ok: true };
};

/**
 * Subscribes to sign-in/sign-out/token-refresh. Call the returned
 * `unsubscribe` on unmount.
 */
export const onAuthStateChange = (
  callback: (event: AuthChangeEvent, session: Session | null) => void,
): Subscription => {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange(callback);
  return subscription;
};
