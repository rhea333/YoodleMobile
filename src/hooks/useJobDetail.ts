import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getJobById, getProfileById } from '../services';
import type { JobRow, ProfileRow, Uuid } from '../types/database';
import { jobKeys } from './useBrowseJobs';
import { profileKeys } from './useProfile';

/**
 * A job and its poster, as two queries rather than one embedded read.
 *
 * PostgREST could fetch them together, but the hand-written `Database` type
 * declares `Relationships: []` on every table, so embedded-resource inference
 * would fall back to loose typing. Two typed reads are cheaper than weakening
 * that, and the poster summary is cached separately and reused.
 */

export const useJobQuery = (jobId: Uuid): UseQueryResult<JobRow, Error> =>
  useQuery({
    queryKey: jobKeys.detail(jobId),
    queryFn: async (): Promise<JobRow> => {
      const result = await getJobById(jobId);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.job;
    },
  });

/**
 * The poster's public summary. Disabled until the job has loaded, since the
 * poster id comes from it.
 *
 * Column grants mean this can only ever return the public fields — display
 * name, photo, bio and the FSA. The full postal code is not readable by anyone
 * but its owner, so a job detail screen cannot expose where the poster lives.
 */
export const usePosterQuery = (posterId: Uuid | undefined): UseQueryResult<ProfileRow, Error> =>
  useQuery({
    queryKey: profileKeys.detail(posterId ?? 'anonymous'),
    enabled: Boolean(posterId),
    queryFn: async (): Promise<ProfileRow> => {
      if (!posterId) {
        throw new Error('No poster.');
      }
      const result = await getProfileById(posterId);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.profile;
    },
  });
