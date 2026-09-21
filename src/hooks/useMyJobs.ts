import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import {
  cancelJob,
  cancelPaymentForJob,
  createJob,
  listMyJobs,
  updateJob,
  type CreateJobInput,
} from '../services';
import type { JobRow, JobUpdate, Uuid } from '../types/database';
import { jobKeys } from './useBrowseJobs';

/**
 * Server state for posting and managing jobs.
 *
 * Every mutation here invalidates `jobKeys.all`, which covers the browse list,
 * the category chips and the user's own list in one go. That is deliberately
 * blunt: a new or cancelled job changes what browse returns, what the category
 * counts say, and what My Jobs shows, and working out precisely which cached
 * pages are affected is more ways to be subtly wrong than it is worth.
 */

export const myJobKeys = {
  mine: (userId: Uuid) => ['jobs', 'mine', userId] as const,
};

export const useMyJobsQuery = (userId: Uuid | undefined): UseQueryResult<JobRow[], Error> =>
  useQuery({
    queryKey: myJobKeys.mine(userId ?? 'anonymous'),
    enabled: Boolean(userId),
    queryFn: async (): Promise<JobRow[]> => {
      if (!userId) {
        throw new Error('No signed-in user.');
      }
      const result = await listMyJobs(userId);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.jobs;
    },
  });

export interface UseCreateJobOptions {
  /** Called with the created row. `photoWarning` is set when the job saved but its photos did not. */
  onSuccess?: (job: JobRow, photoWarning?: string) => void;
}

export const useCreateJobMutation = (options?: UseCreateJobOptions) => {
  const queryClient = useQueryClient();

  return useMutation<{ job: JobRow; photoWarning?: string }, Error, CreateJobInput>({
    mutationFn: async (input) => {
      const result = await createJob(input);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return { job: result.job, photoWarning: result.photoWarning };
    },
    onSuccess: ({ job, photoWarning }) => {
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
      // Seed the detail cache so navigating straight to the new job does not
      // show a spinner for a row we are already holding.
      queryClient.setQueryData(jobKeys.detail(job.id), job);
      options?.onSuccess?.(job, photoWarning);
    },
  });
};

export interface UseUpdateJobOptions {
  onSuccess?: (job: JobRow) => void;
}

export const useUpdateJobMutation = (jobId: Uuid, options?: UseUpdateJobOptions) => {
  const queryClient = useQueryClient();

  return useMutation<JobRow, Error, JobUpdate>({
    mutationFn: async (patch) => {
      const result = await updateJob(jobId, patch);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.job;
    },
    onSuccess: (job) => {
      queryClient.setQueryData(jobKeys.detail(job.id), job);
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
      options?.onSuccess?.(job);
    },
  });
};

export interface UseCancelJobOptions {
  onSuccess?: (job: JobRow) => void;
}

/**
 * Cancel a job, and release any hold standing on the poster's card.
 *
 * THE HOLD COMES FIRST, AND THE ORDER IS THE POINT. A manual-capture
 * PaymentIntent is a real authorisation: the poster's money is unavailable to
 * them until it is cancelled or expires, which can take a week. Cancelling the
 * job first and failing to lift the hold would leave the money stranded on a
 * job that no longer exists, with nothing in the app able to reach it.
 *
 * Failing the other way round is recoverable: the hold is lifted and the job is
 * still live, so the poster can cancel again, or re-accept the offer and pay
 * from the Offers screen.
 *
 * A job with no payment is not a special case — the Edge Function succeeds
 * with nothing to do, and the cancel proceeds.
 */
export const useCancelJobMutation = (options?: UseCancelJobOptions) => {
  const queryClient = useQueryClient();

  return useMutation<JobRow, Error, Uuid>({
    mutationFn: async (jobId) => {
      const released = await cancelPaymentForJob(jobId);
      if (!released.ok) {
        throw new Error(released.message);
      }

      const result = await cancelJob(jobId);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.job;
    },
    onSuccess: (job) => {
      queryClient.setQueryData(jobKeys.detail(job.id), job);
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
      // The hold is gone, so every payment view is stale.
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      options?.onSuccess?.(job);
    },
  });
};
