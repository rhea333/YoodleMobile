import { create } from 'zustand';

/**
 * In-memory notification feed.
 *
 * Client state, not server state, so it lives in Zustand rather than TanStack
 * Query — there is nothing to fetch, only events that arrived over Realtime
 * while the app was open.
 *
 * DELIBERATELY NOT PERSISTED. "Since last opened" means since this launch:
 * quitting the app clears the feed. Persisting it would be a privacy decision
 * as much as a storage one — message previews would end up on disk, and the
 * only encrypted store on the device is reserved for the session. Real
 * durable notifications are a push-notification problem for a later phase.
 *
 * Cleared on sign-out for the same reason the query cache is: the next account
 * to use this device must not see the previous one's messages.
 */

export type NotificationKind = 'message' | 'offer' | 'offer_status';

export interface NotificationItem {
  /** The source row's id, so a replayed event cannot create a duplicate entry. */
  id: string;
  kind: NotificationKind;
  jobId: string;
  /** The other party — who to open a conversation with. */
  otherUserId: string;
  title: string;
  preview: string;
  createdAt: string;
  seen: boolean;
}

interface NotificationsState {
  items: NotificationItem[];
  add: (item: Omit<NotificationItem, 'seen'>) => void;
  markAllSeen: () => void;
  clear: () => void;
}

/** Keeps memory bounded on a long session. Oldest are dropped first. */
const MAX_ITEMS = 100;

export const useNotificationsStore = create<NotificationsState>((set) => ({
  items: [],

  add: (item) =>
    set((state) => {
      // Realtime can redeliver on reconnect, and an offer upsert fires again on
      // every re-bid. Keying on the row id keeps the list honest.
      if (state.items.some((existing) => existing.id === item.id)) {
        return state;
      }
      return { items: [{ ...item, seen: false }, ...state.items].slice(0, MAX_ITEMS) };
    }),

  markAllSeen: () =>
    set((state) => ({ items: state.items.map((item) => ({ ...item, seen: true })) })),

  clear: () => set({ items: [] }),
}));

/**
 * Unread count for the badge.
 *
 * A selector rather than stored state, so it cannot drift out of step with the
 * list it is counting.
 */
export const selectUnreadCount = (state: NotificationsState): number =>
  state.items.reduce((count, item) => (item.seen ? count : count + 1), 0);
