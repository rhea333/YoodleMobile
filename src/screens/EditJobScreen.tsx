import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, CategoryPicker, PhotoPicker, TextInput } from '../components';
import { useJobQuery, useSession, useTheme, useUpdateJobMutation } from '../hooks';
import type { MainStackParamList } from '../navigation/types';
import {
  MAX_JOB_DESCRIPTION_LENGTH,
  MAX_JOB_TITLE_LENGTH,
  deleteJobPhotos,
  jobPhotoUrl,
  uploadJobPhotos,
} from '../services';
import { spacing } from '../theme';
import {
  parseBudget,
  validateJobForm,
  type JobFormErrors,
  type JobFormValues,
} from './jobFormValidation';

type Props = NativeStackScreenProps<MainStackParamList, 'EditJob'>;

/**
 * Edit an existing job.
 *
 * Single page rather than the posting wizard's steps: the values already exist,
 * so there is nothing to walk someone through — they came here to change one
 * thing and leave.
 *
 * LOCATION IS NOT EDITABLE HERE. The exact point is write-only for clients
 * (SELECT on `jobs.location` is revoked), so this screen cannot read the
 * current pin back to show it. Rendering the coarse point instead would be
 * worse than useless: saving it would silently overwrite a real address with a
 * rounded one. Noted in TESTING.md as a known gap.
 */
export const EditJobScreen = ({ navigation, route }: Props) => {
  const { jobId } = route.params;
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { session } = useSession();
  const userId = session?.user.id;

  const jobQuery = useJobQuery(jobId);
  // Only what the user has CHANGED. The form's displayed values are derived
  // from this plus the server row, rather than the row being copied into state
  // by an effect — which would race the query and need a "have I seeded yet"
  // guard. An absent key means "unchanged", and `??` treats an empty string as
  // a real edit, so clearing a field works.
  const [edits, setEdits] = useState<Partial<JobFormValues>>({});
  const [errors, setErrors] = useState<JobFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [savingPhotos, setSavingPhotos] = useState(false);

  const job = jobQuery.data;
  const values: JobFormValues | null = job
    ? {
        title: edits.title ?? job.title,
        description: edits.description ?? job.description ?? '',
        category: edits.category ?? job.category,
        budget: edits.budget ?? (job.budget === null ? '' : String(job.budget)),
        // Location is not editable here; validation is told it is already set.
        location: { lat: 0, long: 0 },
        photoUris: edits.photoUris ?? [],
      }
    : null;

  const updateJob = useUpdateJobMutation(jobId);

  const update = <K extends keyof JobFormValues>(key: K, value: JobFormValues[K]) =>
    setEdits((current) => ({ ...current, [key]: value }));

  const handleSave = async () => {
    if (!values || !userId) {
      return;
    }

    setFormError(null);
    // `budgetOptional`: jobs.budget is nullable, and a job that has no budget
    // must still be editable. An empty field clears it rather than blocking.
    const found = validateJobForm(values, { budgetOptional: true });
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }

    // Captured BEFORE the mutation runs. Its onSuccess writes the new row into
    // the query cache, so reading jobQuery.data afterwards would already show
    // the NEW paths and find nothing to clean up.
    const previousPaths = jobQuery.data?.photo_paths ?? [];

    // New photos REPLACE the existing set. Uploaded first so a failure here
    // leaves the job's text untouched rather than half-saved.
    let photoPaths: string[] | undefined;
    if (values.photoUris.length > 0) {
      setSavingPhotos(true);
      const uploaded = await uploadJobPhotos(userId, jobId, values.photoUris);
      setSavingPhotos(false);
      if (!uploaded.ok) {
        setFormError(uploaded.message);
        return;
      }
      photoPaths = uploaded.paths;
    }

    try {
      await updateJob.mutateAsync({
        title: values.title,
        description: values.description,
        category: values.category ?? 'other',
        budget: parseBudget(values.budget),
        ...(photoPaths ? { photo_paths: photoPaths } : {}),
      });
    } catch {
      // Rendered from updateJob.error below; nothing to add here.
      return;
    }

    if (photoPaths) {
      // The row has stopped referencing the old objects, so delete them. This
      // matters more than ordinary tidiness: job-photos is a PUBLIC bucket, so
      // an orphan left behind stays fetchable by anyone who ever saw its URL —
      // a poster who removes a photo would not have actually withdrawn it.
      // Best-effort: the save already succeeded, so a failed delete must not
      // fail the edit.
      const kept = photoPaths;
      void deleteJobPhotos(previousPaths.filter((path) => !kept.includes(path)));
    }

    navigation.goBack();
  };

  // ORDER MATTERS. `values` is derived from the query data, so a failed fetch
  // leaves it null — and checking `!values` first would swallow the error into
  // a spinner that never resolves, with no message and no way out.
  if (jobQuery.isError) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-lg">
        <Text className="text-center text-body text-text-secondary">{jobQuery.error.message}</Text>
        <View className="mt-lg">
          <Button label="Try again" onPress={() => void jobQuery.refetch()} variant="secondary" />
        </View>
      </View>
    );
  }

  if (jobQuery.isPending || !values) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const existingPhotos = jobQuery.data.photo_paths;
  const busy = updateJob.isPending || savingPhotos;

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
        <View className="gap-lg">
          <TextInput
            error={errors.title}
            label="Title"
            maxLength={MAX_JOB_TITLE_LENGTH}
            onChangeText={(text) => update('title', text)}
            value={values.title}
          />
          <TextInput
            error={errors.description}
            label="Description"
            maxLength={MAX_JOB_DESCRIPTION_LENGTH}
            multiline
            onChangeText={(text) => update('description', text)}
            value={values.description}
          />
          <CategoryPicker
            error={errors.category}
            onChange={(category) => update('category', category)}
            value={values.category}
          />
          <TextInput
            error={errors.budget}
            keyboardType="decimal-pad"
            label="Budget"
            onChangeText={(text) => update('budget', text)}
            value={values.budget}
          />

          {existingPhotos.length > 0 ? (
            <View>
              <Text className="mb-sm text-footnote font-medium text-text-secondary">
                Current photos
              </Text>
              <View className="flex-row flex-wrap gap-sm">
                {existingPhotos.map((path) => (
                  <Image
                    className="h-24 w-24 rounded-md"
                    key={path}
                    source={{ uri: jobPhotoUrl(path) }}
                  />
                ))}
              </View>
            </View>
          ) : null}

          <PhotoPicker
            disabled={busy}
            label={existingPhotos.length > 0 ? 'Replace photos' : 'Photos'}
            onChange={(uris) => update('photoUris', uris)}
            value={values.photoUris}
          />
          {values.photoUris.length > 0 && existingPhotos.length > 0 ? (
            <Text className="text-caption text-text-muted">
              Saving will replace the current photos with these.
            </Text>
          ) : null}

          <Text className="text-caption text-text-muted">
            The job&rsquo;s location cannot be changed here. Cancel the job and post it again to
            move it.
          </Text>
        </View>

        {(formError ?? updateJob.error) ? (
          <View className="mt-lg">
            <Card padding="sm" variant="filled">
              <Text className="text-footnote text-danger">
                {formError ?? updateJob.error?.message}
              </Text>
            </Card>
          </View>
        ) : null}

        <View className="mt-xl gap-md">
          <Button
            fullWidth
            label="Save changes"
            loading={busy}
            onPress={() => void handleSave()}
            size="lg"
          />
          <Button
            disabled={busy}
            fullWidth
            label="Discard"
            onPress={() => navigation.goBack()}
            variant="ghost"
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};
