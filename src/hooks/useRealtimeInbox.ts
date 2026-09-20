import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { offerStatusLabel, subscribeToInbox, unsubscribe } from '../services';
import { useNotificationsStore } from '../state/notifications';
import type { Uuid } from '../types/database';
import { offerKeys } from './useOffers';
import { threadKeys } from './useThread';

/**
 * The app-wide subscription behind the notification badge.
 *
 * Mounted once, by `RootNavigator`, for as long as there is a session — so it
 * keeps running while the user is on any screen, which is the point of a badge.
 *
 * It does two things per event: records a notification, and invalidates the
 * queries the event has just made stale. Without the second, a user could see
 * "1 new offer" and then open a list that does not contain it.
 */
export const useRealtimeInbox = (selfId: Uuid | undefined): void => {
  const queryClient = useQueryClient();
  const addNotification = useNotificationsStore((state) => state.add);

  useEffect(() => {
    if (!selfId) {
      return;
    }

    const channel = subscribeToInbox(selfId, {
      onMessage: (message) => {
        addNotification({
          id: message.id,
          kind: 'message',
          jobId: message.job_id,
          otherUserId: message.sender_id,
          title: 'New message',
          preview: message.body,
          createdAt: message.created_at,
        });

        // The open thread, if any, updates itself through its own
        // subscription; this covers every other thread.
        void queryClient.invalidateQueries({ queryKey: threadKeys.all });
      },

      onOffer: (offer) => {
        addNotification({
          id: offer.id,
          kind: 'offer',
          jobId: offer.job_id,
          otherUserId: offer.worker_id,
          title: 'New offer on your job',
          preview: offer.message ?? `A neighbour offered $${offer.amount}.`,
          createdAt: offer.created_at,
        });

        void queryClient.invalidateQueries({ queryKey: offerKeys.all });
      },

      onOfferUpdate: (offer) => {
        // Always refresh. RLS only delivers offers this user is party to, and
        // BOTH sides have a list that just went stale — the worker's "Your
        // offers" and the poster's "Offers on your jobs".
        void queryClient.invalidateQueries({ queryKey: offerKeys.all });

        const isOwnBid = offer.worker_id === selfId;

        // Do not notify someone about something they just did themselves. The
        // payload does not say who wrote it — with the default replica identity
        // there is no `old` row to compare against — but the DIRECTION of the
        // transition does, because migration 0016 makes each side's moves
        // exclusive: only a poster can accept or decline, only a worker can
        // move an offer to pending or withdrawn.
        const worthTelling = isOwnBid
          ? offer.status === 'accepted' || offer.status === 'declined'
          : offer.status === 'pending' || offer.status === 'withdrawn';

        if (!worthTelling) {
          return;
        }

        const title = isOwnBid
          ? `Your offer was ${offerStatusLabel(offer.status).toLowerCase()}`
          : offer.status === 'withdrawn'
            ? 'A neighbour withdrew their offer'
            : 'A neighbour updated their offer';

        addNotification({
          // Keyed on the write, not the status. `${id}:${status}` collapsed a
          // repeat transition — declined, re-bid, declined again — into a
          // single entry, so the second decline was never shown. `updated_at`
          // is set by trigger on every write (0016), so each transition is
          // distinct while a redelivered event still de-duplicates.
          id: `${offer.id}:${offer.updated_at}`,
          kind: 'offer_status',
          jobId: offer.job_id,
          otherUserId: offer.worker_id,
          title,
          preview: `$${offer.amount}`,
          createdAt: offer.updated_at,
        });
      },
    });

    return () => {
      void unsubscribe(channel);
    };
  }, [selfId, queryClient, addNotification]);
};
