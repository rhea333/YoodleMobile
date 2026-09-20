import {
  MAX_JOB_DESCRIPTION_LENGTH,
  MAX_JOB_TITLE_LENGTH,
  MIN_JOB_TITLE_LENGTH,
  sanitizeJobDescription,
  sanitizeJobTitle,
} from '../services';
import type { Coordinates } from '../hooks/useBrowseLocation';

/**
 * Validation shared by the post and edit forms.
 *
 * Validation runs on the SANITISED value, not the raw one. Otherwise a title of
 * nothing but zero-width characters passes the "not empty" check and then
 * arrives at the database as an empty string, failing a CHECK constraint with
 * an error no user can act on.
 *
 * Required: title, category, budget, location. Description is optional — the
 * column is nullable and a short listing is better than a padded one.
 *
 * `budgetOptional` exists for the edit form. `jobs.budget` is nullable, so a
 * row can legitimately have no budget — and requiring one unconditionally made
 * such a job impossible to edit at all, since every save failed validation on a
 * field the user had never touched. When set, an EMPTY budget is accepted; a
 * budget that is present still has to be a positive number.
 */

export interface JobFormValues {
  title: string;
  description: string;
  category: string | null;
  /** Raw text from the input, so "12.50" and "" are both representable. */
  budget: string;
  location: Coordinates | null;
  photoUris: string[];
}

export interface JobFormErrors {
  title?: string;
  description?: string;
  category?: string;
  budget?: string;
  location?: string;
}

/** Parses the budget field. Returns null when it is not a usable number. */
export const parseBudget = (raw: string): number | null => {
  const trimmed = raw.trim().replace(/^\$/, '').replace(/,/g, '');
  if (trimmed.length === 0) {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
};

export interface ValidateJobFormOptions {
  budgetOptional?: boolean;
}

export const validateJobForm = (
  values: JobFormValues,
  options: ValidateJobFormOptions = {},
): JobFormErrors => {
  const errors: JobFormErrors = {};

  const title = sanitizeJobTitle(values.title);
  if (title.length === 0) {
    errors.title = 'Please give the job a title.';
  } else if (title.length < MIN_JOB_TITLE_LENGTH) {
    errors.title = `Please use at least ${MIN_JOB_TITLE_LENGTH} characters.`;
  } else if (title.length > MAX_JOB_TITLE_LENGTH) {
    errors.title = `Please keep the title under ${MAX_JOB_TITLE_LENGTH} characters.`;
  }

  if (sanitizeJobDescription(values.description).length > MAX_JOB_DESCRIPTION_LENGTH) {
    errors.description = `Please keep the description under ${MAX_JOB_DESCRIPTION_LENGTH} characters.`;
  }

  if (!values.category) {
    errors.category = 'Please choose a category.';
  }

  const budget = parseBudget(values.budget);
  if (budget === null) {
    if (!options.budgetOptional) {
      errors.budget = 'Please enter a budget.';
    }
  } else if (budget <= 0) {
    // The spec's explicit case: 0 is not a valid budget, and neither is -5.
    errors.budget = 'Please enter an amount greater than zero.';
  } else if (budget > 100_000) {
    errors.budget = 'That budget looks too high. Please check it.';
  }

  if (!values.location) {
    errors.location = 'Please set the job location on the map.';
  }

  return errors;
};

/** Which fields belong to which step, so a step only blocks on its own errors. */
export const STEP_FIELDS: Record<number, (keyof JobFormErrors)[]> = {
  0: ['title', 'description', 'category'],
  1: ['budget', 'location'],
  2: [],
};

export const errorsForStep = (errors: JobFormErrors, step: number): JobFormErrors => {
  const fields = STEP_FIELDS[step] ?? [];
  const subset: JobFormErrors = {};
  for (const field of fields) {
    if (errors[field]) {
      subset[field] = errors[field];
    }
  }
  return subset;
};

export const hasErrors = (errors: JobFormErrors): boolean => Object.keys(errors).length > 0;
