import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { cancelJob, createJob, listMyJobs, updateJob, type CreateJobInput } from '../services';
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

export const useCancelJobMutation = (options?: UseCancelJobOptions) => {
  const queryClient = useQueryClient();

  return useMutation<JobRow, Error, Uuid>({
    mutationFn: async (jobId) => {
      const result = await cancelJob(jobId);
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
