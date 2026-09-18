import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, Button, Card, TextInput } from '../components';
import {
  useProfileQuery,
  useSession,
  useUpdateProfileMutation,
  useUploadAvatarMutation,
} from '../hooks';
import type { MainStackParamList } from '../navigation/types';
import { MAX_AVATAR_BYTES, validateAvatar } from '../services';
import { spacing } from '../theme';

type Props = NativeStackScreenProps<MainStackParamList, 'CompleteProfile'>;

const MAX_BIO_LENGTH = 500;

/**
 * "Complete your profile" — photo and bio. Skippable: both fields are
 * optional, and nobody should be trapped in onboarding by a failed upload.
 *
 * Reached after sign-in, so there is always a session and RLS permits the
 * writes. Reads and writes go through TanStack Query, never a raw useEffect
 * fetch.
 */
export const CompleteProfileScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const userId = session?.user.id;

  const profileQuery = useProfileQuery(userId);
  const [bio, setBio] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const uploadAvatar = useUploadAvatarMutation(userId, {
    onSuccess: () => setLocalError(null),
  });
  const updateProfile = useUpdateProfileMutation(userId, {
    onSuccess: () => navigation.replace('Home'),
  });

  // The query is the source of truth until the user edits the field.
  const bioValue = bio ?? profileQuery.data?.bio ?? '';

  const handlePickPhoto = async () => {
    setLocalError(null);

    // Ask before opening the picker, so a denial is explained rather than
    // appearing as an empty sheet.
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setLocalError('Yoodle needs access to your photos to set a profile picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      // Array form; `MediaTypeOptions` is deprecated in SDK 57.
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      // No EXIF: it can carry GPS coordinates of where the photo was taken,
      // which would quietly undo the location-privacy work in the schema.
      exif: false,
    });

    if (result.canceled || result.assets.length === 0) {
      return;
    }

    const asset = result.assets[0];
    if (!asset) {
      return;
    }

    // Validate before any bytes leave the device. Storage enforces the same
    // limits server-side; this is the fast, explainable failure.
    const validation = validateAvatar({
      uri: asset.uri,
      mimeType: asset.mimeType,
      fileSize: asset.fileSize,
      fileName: asset.fileName ?? undefined,
    });

    if (!validation.ok) {
      setLocalError(validation.message);
      return;
    }

    uploadAvatar.mutate({
      uri: asset.uri,
      mimeType: asset.mimeType,
      fileSize: asset.fileSize,
      fileName: asset.fileName ?? undefined,
    });
  };

  const handleSave = () => {
    setLocalError(null);
    const trimmed = bioValue.trim();
    updateProfile.mutate({ bio: trimmed.length > 0 ? trimmed : null });
  };

  const errorMessage =
    localError ??
    uploadAvatar.error?.message ??
    updateProfile.error?.message ??
    (profileQuery.isError ? profileQuery.error.message : null);

  const maxMb = Math.round(MAX_AVATAR_BYTES / (1024 * 1024));

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
        <Text className="text-heading font-bold text-text-primary">Complete your profile</Text>
        <Text className="mb-xl mt-xs text-footnote text-text-secondary">
          Optional, but neighbours are more likely to accept an offer from someone with a photo.
        </Text>

        <View className="items-center">
          <Avatar
            name={profileQuery.data?.display_name ?? undefined}
            size="xl"
            uri={profileQuery.data?.avatar_url ?? undefined}
          />
          <View className="mt-md">
            <Button
              label={profileQuery.data?.avatar_url ? 'Change photo' : 'Add a photo'}
              loading={uploadAvatar.isPending}
              onPress={() => void handlePickPhoto()}
              variant="secondary"
            />
          </View>
          <Text className="mt-sm text-caption text-text-muted">
            JPEG, PNG, WebP or HEIC, up to {maxMb} MB.
          </Text>
        </View>

        <View className="mt-xl">
          <TextInput
            helperText={`${bioValue.length}/${MAX_BIO_LENGTH} characters.`}
            label="Short bio"
            maxLength={MAX_BIO_LENGTH}
            multiline
            onChangeText={setBio}
            placeholder="Handy with tools, free most weekends, happy to help with yard work."
            value={bioValue}
          />
        </View>

        {errorMessage ? (
          <View className="mt-lg">
            <Card padding="sm" variant="filled">
              <Text className="text-footnote text-danger">{errorMessage}</Text>
            </Card>
          </View>
        ) : null}

        <View className="mt-xl gap-md">
          <Button
            fullWidth
            label="Save and continue"
            loading={updateProfile.isPending}
            onPress={handleSave}
            size="lg"
          />
          <Button
            fullWidth
            label="Skip for now"
            onPress={() => navigation.replace('Home')}
            variant="ghost"
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};
