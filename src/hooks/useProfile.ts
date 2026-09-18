import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { getMyProfile, updateMyProfile, uploadMyAvatar, type PickedImage } from '../services';
import type { ProfileRow, ProfileUpdate, Uuid } from '../types/database';

/**
 * TanStack Query hooks for the profile. Server state lives here, not in
 * `useEffect` fetches, so caching, refetching and invalidation are handled in
 * one place.
 *
 * The service functions return discriminated results rather than throwing, so
 * each hook converts a `{ ok: false }` into a thrown error — that is what
 * Query needs in order to populate `error` and drive retries.
 */

export const profileKeys = {
  all: ['profiles'] as const,
  detail: (userId: Uuid) => ['profiles', userId] as const,
};

export const useProfileQuery = (userId: Uuid | undefined): UseQueryResult<ProfileRow, Error> =>
  useQuery({
    queryKey: profileKeys.detail(userId ?? 'anonymous'),
    // Disabled until there is a signed-in user to fetch.
    enabled: Boolean(userId),
    queryFn: async (): Promise<ProfileRow> => {
      if (!userId) {
        throw new Error('No signed-in user.');
      }
      const result = await getMyProfile(userId);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.profile;
    },
  });

export interface UseUpdateProfileOptions {
  onSuccess?: (profile: ProfileRow) => void;
}

export const useUpdateProfileMutation = (
  userId: Uuid | undefined,
  options?: UseUpdateProfileOptions,
) => {
  const queryClient = useQueryClient();

  return useMutation<ProfileRow, Error, ProfileUpdate>({
    mutationFn: async (patch) => {
      if (!userId) {
        throw new Error('No signed-in user.');
      }
      const result = await updateMyProfile(userId, patch);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.profile;
    },
    onSuccess: (profile) => {
      // Seed the cache with the row the server actually returned, so the UI
      // reflects trigger-derived values (postal_fsa) rather than what was sent.
      queryClient.setQueryData(profileKeys.detail(profile.id), profile);
      options?.onSuccess?.(profile);
    },
  });
};

export interface UseUploadAvatarOptions {
  onSuccess?: (publicUrl: string) => void;
}

export const useUploadAvatarMutation = (
  userId: Uuid | undefined,
  options?: UseUploadAvatarOptions,
) => {
  const queryClient = useQueryClient();

  return useMutation<string, Error, PickedImage>({
    mutationFn: async (image) => {
      if (!userId) {
        throw new Error('No signed-in user.');
      }
      const result = await uploadMyAvatar(userId, image);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.publicUrl;
    },
    onSuccess: (publicUrl) => {
      if (userId) {
        // uploadMyAvatar already wrote avatar_url, so refetch rather than
        // guessing at the merged row.
        void queryClient.invalidateQueries({ queryKey: profileKeys.detail(userId) });
      }
      options?.onSuccess?.(publicUrl);
    },
  });
};
