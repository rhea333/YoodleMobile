import type { RealtimeChannel } from '@supabase/supabase-js';

import type { MessageRow, OfferRow, Uuid } from '../types/database';
import { sanitizeMessageBody } from './sanitize';
import { supabase } from './supabase';

/**
 * Direct messages about a job, and the Realtime subscriptions that keep them
 * live.
 *
 * REALTIME AND RLS — the thing to understand before changing anything here.
 *
 * Supabase applies RLS to Realtime `postgres_changes` events for INSERT and
 * UPDATE: each event is authorised against each subscriber, so a third party
 * subscribed to `messages` receives nothing from a conversation
 * `messages_select_own_thread` would not have let them SELECT.
 *
 * DELETE IS THE EXCEPTION, and it is documented as such: "RLS policies are not
 * applied to DELETE statements, because there is no way for Postgres to verify
 * that a user has access to a deleted record." Two things keep that from
 * mattering here:
 *
 *   1. `messages` is left at the DEFAULT replica identity (migration 0015), so
 *      a DELETE replicates only the primary key. The payload that escapes RLS
 *      is a bare id, not a message body. Setting REPLICA IDENTITY FULL would
 *      broadcast the full row — including `body` — to every subscriber.
 *   2. Nothing below subscribes to DELETE. The events are never asked for.
 *
 * Either alone would be enough; both together mean a future change has to
 * undo two separate decisions to create a leak.
 */

const MESSAGE_COLUMNS = 'id, job_id, sender_id, recipient_id, body, created_at';

export interface ServiceFailure {
  ok: false;
  message: string;
}

export type MessagesResult = { ok: true; messages: MessageRow[] } | ServiceFailure;
export type MessageResult = { ok: true; message: MessageRow } | ServiceFailure;

/**
 * One conversation: this job, these two people, oldest first.
 *
 * The pair filter is belt-and-braces over RLS. `messages_select_own_thread`
 * already restricts rows to threads the caller is in, but a poster with several
 * workers on one job is in several threads at once — without the explicit pair
 * filter they would all arrive in the same list.
 */
export const listThread = async (
  jobId: Uuid,
  selfId: Uuid,
  otherId: Uuid,
): Promise<MessagesResult> => {
  const { data, error } = await supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('job_id', jobId)
    .or(
      `and(sender_id.eq.${selfId},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${selfId})`,
    )
    .order('created_at', { ascending: true });

  if (error) {
    return { ok: false, message: 'Could not load this conversation. Please try again.' };
  }

  return { ok: true, messages: data ?? [] };
};

export interface SendMessageInput {
  jobId: Uuid;
  senderId: Uuid;
  recipientId: Uuid;
  body: string;
}

/**
 * Send a message.
 *
 * Sanitised before sending, exactly as job text is: a message is rendered back
 * to someone the sender is about to meet, so invisible or direction-flipping
 * characters matter more here than in a listing.
 */
export const sendMessage = async (input: SendMessageInput): Promise<MessageResult> => {
  const body = sanitizeMessageBody(input.body);

  if (body.length === 0) {
    return { ok: false, message: 'Write something first.' };
  }

  const { data, error } = await supabase
    .from('messages')
    .insert({
      job_id: input.jobId,
      sender_id: input.senderId,
      recipient_id: input.recipientId,
      body,
    })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error || !data) {
    // `messages_insert_own_thread` refuses anyone who is not a party to the
    // job, or a recipient who is not the counterparty.
    return { ok: false, message: 'Could not send that message. You may no longer be on this job.' };
  }

  return { ok: true, message: data };
};

/**
 * Live updates for ONE conversation.
 *
 * The server-side `filter` narrows to the job. The rest of the pairing is
 * checked in the callback, because `postgres_changes` filters take a single
 * column comparison and cannot express "either direction of this pair".
 *
 * INSERT only — see the header on DELETE, and there is no UPDATE path for
 * messages at all (the privilege is revoked and no policy exists).
 */
export const subscribeToThread = (
  jobId: Uuid,
  selfId: Uuid,
  otherId: Uuid,
  onMessage: (message: MessageRow) => void,
): RealtimeChannel => {
  const channel = supabase
    .channel(`thread:${jobId}:${selfId}:${otherId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `job_id=eq.${jobId}` },
      (payload) => {
        const row = payload.new as MessageRow;
        const inThisPair =
          (row.sender_id === selfId && row.recipient_id === otherId) ||
          (row.sender_id === otherId && row.recipient_id === selfId);

        if (inThisPair) {
          onMessage(row);
        }
      },
    )
    .subscribe();

  return channel;
};

export interface InboxHandlers {
  onMessage: (message: MessageRow) => void;
  onOffer: (offer: OfferRow) => void;
  /**
   * Any UPDATE to an offer this user is party to — their own bid moving, or a
   * worker amending a bid on their job. Who should hear about it, and whether
   * it is worth a notification at all, is decided by the caller.
   */
  onOfferUpdate: (offer: OfferRow) => void;
}

/**
 * App-wide subscription that feeds the notification badge.
 *
 * Messages are filtered server-side to those addressed to this user. Offers
 * are NOT filtered, deliberately: the interesting case is "an offer arrived on
 * a job I posted", which `postgres_changes` cannot express — it takes one
 * column comparison, and the link runs through `jobs.poster_id`.
 *
 * Leaning on RLS instead is safe and is rather the point: `offers_select_own`
 * and `offers_select_as_poster` mean the only offer events that reach this
 * client are ones the user could already have SELECTed. A rival worker's bid on
 * the same job is never delivered. The callback drops the user's own bids,
 * which are visible but not news.
 */
export const subscribeToInbox = (selfId: Uuid, handlers: InboxHandlers): RealtimeChannel => {
  const channel = supabase
    .channel(`inbox:${selfId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `recipient_id=eq.${selfId}`,
      },
      (payload) => handlers.onMessage(payload.new as MessageRow),
    )
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'offers' }, (payload) => {
      const offer = payload.new as OfferRow;
      // Our own bid coming back to us is not a notification.
      if (offer.worker_id !== selfId) {
        handlers.onOffer(offer);
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'offers' }, (payload) => {
      // Every update RLS lets through, not just the ones on this user's own
      // bids. Filtering to `worker_id === selfId` here meant a POSTER was never
      // told when a worker amended their price, and their Offers screen kept
      // showing the old number indefinitely.
      handlers.onOfferUpdate(payload.new as OfferRow);
    })
    .subscribe();

  return channel;
};

/** Tear a channel down. Always call this on unmount. */
export const unsubscribe = async (channel: RealtimeChannel): Promise<void> => {
  await supabase.removeChannel(channel);
};
