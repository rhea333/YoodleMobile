import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Button,
  Card,
  CategoryPicker,
  LocationPicker,
  PhotoPicker,
  TextInput,
} from '../components';
import {
  useCreateJobMutation,
  useProfileQuery,
  useSession,
  usePostingLocation,
  type Coordinates,
} from '../hooks';
import type { MainStackParamList } from '../navigation/types';
import { MAX_JOB_DESCRIPTION_LENGTH, MAX_JOB_TITLE_LENGTH, formatBudget } from '../services';
import { spacing } from '../theme';
import {
  errorsForStep,
  hasErrors,
  parseBudget,
  validateJobForm,
  type JobFormErrors,
  type JobFormValues,
} from './jobFormValidation';

type Props = NativeStackScreenProps<MainStackParamList, 'PostJob'>;

const STEP_TITLES = ['What needs doing?', 'Budget and location', 'Photos'];
const LAST_STEP = STEP_TITLES.length - 1;

/**
 * Multi-step "Post a job".
 *
 * Steps exist so a phone keyboard is not fighting six fields at once, but the
 * form is ONE state object validated as a whole. Each step shows only its own
 * errors (`errorsForStep`), so advancing is blocked by that step's problems
 * while the final submit still checks everything — a field left invalid on step
 * 1 cannot slip through because the user never went back to it.
 *
 * Errors are inline, next to the field. No alerts: an alert has to be dismissed
 * before the user can look at what it is complaining about.
 */
export const PostJobScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const userId = session?.user.id;
  const profileQuery = useProfileQuery(userId);

  const [step, setStep] = useState(0);
  const [values, setValues] = useState<JobFormValues>({
    title: '',
    description: '',
    category: null,
    budget: '',
    location: null,
    photoUris: [],
  });
  // Only populated after a submit/next attempt, so the form does not shout at
  // someone who has not finished typing their first field yet.
  const [errors, setErrors] = useState<JobFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const posting = usePostingLocation(profileQuery.data?.postal_fsa);

  // The pin's effective position: whatever the user dragged, else the suggested
  // starting point. Derived rather than copied into state by an effect — once
  // `values.location` is set it always wins, so a late-arriving suggestion can
  // never yank the pin back from where the user put it.
  const location = values.location ?? posting.suggested;
  const formValues: JobFormValues = { ...values, location };

  // Set when the job saved but its photos did not. The job EXISTS at this
  // point, so the screen stops being a form and becomes a way through to it.
  const [postedJobId, setPostedJobId] = useState<string | null>(null);

  const createJob = useCreateJobMutation({
    onSuccess: (job, photoWarning) => {
      if (photoWarning) {
        // Do NOT navigate. Previously this called replace() and then set the
        // warning, which set state on an unmounting screen — so the message was
        // never rendered and the user reached their job believing the photos
        // had attached. Staying put is the only way the warning is read.
        setPostedJobId(job.id);
        setSubmitError(photoWarning);
        return;
      }

      // Replace rather than push: backing out of a job you just posted should
      // not land you in the form again with stale state.
      navigation.replace('JobDetail', { jobId: job.id });
    },
  });

  const update = <K extends keyof JobFormValues>(key: K, value: JobFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const handleNext = () => {
    const all = validateJobForm(formValues);
    const stepErrors = errorsForStep(all, step);
    setErrors(stepErrors);
    if (!hasErrors(stepErrors)) {
      setStep((current) => Math.min(current + 1, LAST_STEP));
    }
  };

  const handleSubmit = () => {
    setSubmitError(null);
    const all = validateJobForm(formValues);
    setErrors(all);

    if (hasErrors(all)) {
      // Send the user back to the earliest step that has a problem, otherwise
      // the errors are on a screen they cannot see.
      const firstBadStep = [0, 1, 2].find((index) => hasErrors(errorsForStep(all, index)));
      if (firstBadStep !== undefined) {
        setStep(firstBadStep);
      }
      return;
    }

    const budget = parseBudget(values.budget);
    if (!userId || budget === null || !location) {
      return;
    }

    createJob.mutate({
      posterId: userId,
      title: values.title,
      description: values.description,
      category: values.category ?? 'other',
      budget,
      lat: location.lat,
      long: location.long,
      photoUris: values.photoUris,
    });
  };

  const locationHint =
    posting.source === 'gps'
      ? 'Starting from where you are now. Drag the pin to the exact spot.'
      : posting.source === 'neighbourhood'
        ? `Starting from your ${profileQuery.data?.postal_fsa ?? ''} neighbourhood. Drag the pin to the exact spot.`
        : posting.status === 'unavailable'
          ? 'We could not guess your location. Tap the map to set it.'
          : undefined;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background"
    >
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: insets.bottom + spacing['2xl'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-caption font-medium text-text-muted">
          Step {step + 1} of {STEP_TITLES.length}
        </Text>
        <Text className="mb-xl mt-xs text-heading font-bold text-text-primary">
          {STEP_TITLES[step]}
        </Text>

        {step === 0 ? (
          <View className="gap-lg">
            <TextInput
              error={errors.title}
              helperText={`${values.title.length}/${MAX_JOB_TITLE_LENGTH}`}
              label="Title"
              maxLength={MAX_JOB_TITLE_LENGTH}
              onChangeText={(text) => update('title', text)}
              placeholder="e.g. Shovel my driveway"
              value={values.title}
            />
            <TextInput
              error={errors.description}
              helperText="Optional. What needs doing, and anything a helper should know."
              label="Description"
              maxLength={MAX_JOB_DESCRIPTION_LENGTH}
              multiline
              onChangeText={(text) => update('description', text)}
              placeholder="Two-car driveway, salt provided. Looking for someone this weekend."
              value={values.description}
            />
            <CategoryPicker
              error={errors.category}
              onChange={(category) => update('category', category)}
              value={values.category}
            />
          </View>
        ) : null}

        {step === 1 ? (
          <View className="gap-lg">
            <TextInput
              error={errors.budget}
              helperText="What you are willing to pay, in Canadian dollars."
              keyboardType="decimal-pad"
              label="Budget"
              onChangeText={(text) => update('budget', text)}
              placeholder="40"
              value={values.budget}
            />
            <LocationPicker
              error={errors.location}
              hint={locationHint}
              onChange={(coords: Coordinates) => update('location', coords)}
              value={location}
            />
          </View>
        ) : null}

        {step === 2 ? (
          <View className="gap-lg">
            <PhotoPicker
              disabled={createJob.isPending}
              onChange={(uris) => update('photoUris', uris)}
              value={values.photoUris}
            />

            <Card padding="sm" title="Review" variant="filled">
              <Text className="text-body text-text-primary">{values.title || '(no title)'}</Text>
              <Text className="mt-xs text-footnote text-text-secondary">
                {values.category ?? '(no category)'} ·{' '}
                {formatBudget(parseBudget(values.budget)) ?? '(no budget)'}
              </Text>
              {values.description ? (
                <Text className="mt-sm text-footnote text-text-secondary" numberOfLines={3}>
                  {values.description}
                </Text>
              ) : null}
              <Text className="mt-sm text-caption text-text-muted">
                Neighbours will see this at neighbourhood level, not your exact address.
              </Text>
            </Card>
          </View>
        ) : null}

        {(submitError ?? createJob.error) ? (
          <View className="mt-lg">
            <Card padding="sm" variant="filled">
              <Text className="text-footnote text-danger">
                {submitError ?? createJob.error?.message}
              </Text>
            </Card>
          </View>
        ) : null}

        <View className="mt-xl gap-md">
          {postedJobId ? (
            <Button
              fullWidth
              label="Continue to your job"
              onPress={() => navigation.replace('JobDetail', { jobId: postedJobId })}
              size="lg"
            />
          ) : step < LAST_STEP ? (
            <Button fullWidth label="Continue" onPress={handleNext} size="lg" />
          ) : (
            <Button
              fullWidth
              label="Post this job"
              loading={createJob.isPending}
              onPress={handleSubmit}
              size="lg"
            />
          )}
          {step > 0 ? (
            <Button
              disabled={createJob.isPending}
              fullWidth
              label="Back"
              onPress={() => setStep((current) => Math.max(0, current - 1))}
              variant="ghost"
            />
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};
