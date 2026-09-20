import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect } from 'react';

import { listThread, sendMessage, subscribeToThread, unsubscribe } from '../services';
import type { MessageRow, Uuid } from '../types/database';

/**
 * One conversation, kept live.
 *
 * The initial load is a normal query; Realtime then pushes new rows straight
 * into that query's cache. Not polling, and not a refetch per event either —
 * the event carries the row, so refetching would be a second round trip for
 * data already in hand.
 */

export const threadKeys = {
  all: ['thread'] as const,
  detail: (jobId: Uuid, otherId: Uuid) => ['thread', jobId, otherId] as const,
};

export const useThreadQuery = (
  jobId: Uuid,
  selfId: Uuid | undefined,
  otherId: Uuid,
): UseQueryResult<MessageRow[], Error> =>
  useQuery({
    queryKey: threadKeys.detail(jobId, otherId),
    enabled: Boolean(selfId),
    queryFn: async (): Promise<MessageRow[]> => {
      if (!selfId) {
        throw new Error('No signed-in user.');
      }
      const result = await listThread(jobId, selfId, otherId);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.messages;
    },
  });

/**
 * Subscribe while the screen is mounted.
 *
 * The channel is torn down on unmount and re-created if the participants
 * change. Leaving it open would keep a websocket subscription per screen the
 * user has ever visited.
 */
export const useThreadRealtime = (jobId: Uuid, selfId: Uuid | undefined, otherId: Uuid): void => {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!selfId) {
      return;
    }

    const channel = subscribeToThread(jobId, selfId, otherId, (message) => {
      queryClient.setQueryData<MessageRow[]>(threadKeys.detail(jobId, otherId), (current) => {
        const existing = current ?? [];
        // The sender already appended this row optimistically from the insert's
        // response, and a reconnect can redeliver. Either way, id wins.
        if (existing.some((item) => item.id === message.id)) {
          return existing;
        }
        return [...existing, message];
      });
    });

    return () => {
      void unsubscribe(channel);
    };
  }, [jobId, selfId, otherId, queryClient]);
};

export interface UseSendMessageOptions {
  onSuccess?: (message: MessageRow) => void;
}

export const useSendMessageMutation = (
  jobId: Uuid,
  selfId: Uuid | undefined,
  otherId: Uuid,
  options?: UseSendMessageOptions,
) => {
  const queryClient = useQueryClient();

  return useMutation<MessageRow, Error, string>({
    mutationFn: async (body) => {
      if (!selfId) {
        throw new Error('No signed-in user.');
      }
      const result = await sendMessage({
        jobId,
        senderId: selfId,
        recipientId: otherId,
        body,
      });
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.message;
    },
    onSuccess: (message) => {
      // Append immediately rather than waiting for the round trip back through
      // Realtime, so the sender's own message does not lag behind their typing.
      // The subscription's id check stops it arriving twice.
      queryClient.setQueryData<MessageRow[]>(threadKeys.detail(jobId, otherId), (current) => {
        const existing = current ?? [];
        if (existing.some((item) => item.id === message.id)) {
          return existing;
        }
        return [...existing, message];
      });
      options?.onSuccess?.(message);
    },
  });
};
