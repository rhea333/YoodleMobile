import * as ImagePicker from 'expo-image-picker';
import { Image, Pressable, Text, View } from 'react-native';

import { MAX_JOB_PHOTOS } from '../services';
import { Button } from './Button';

export interface PhotoPickerProps {
  /** Local URIs, or remote URLs when editing an existing job. */
  value: string[];
  onChange: (uris: string[]) => void;
  max?: number;
  error?: string;
  label?: string;
  disabled?: boolean;
}

/**
 * Pick up to `max` photos.
 *
 * NOTE ON EXIF, because the wrong conclusion is easy to draw from this file:
 * nothing is stripped here. `exif: false` below only keeps the metadata out of
 * the object the picker hands back to JavaScript — the file on disk is
 * untouched. The actual stripping happens at upload time, in
 * `prepareImageForUpload`, which re-encodes the image. Do not treat a URI that
 * came out of this component as safe to upload directly.
 */
export const PhotoPicker = ({
  value,
  onChange,
  max = MAX_JOB_PHOTOS,
  error,
  label = 'Photos',
  disabled = false,
}: PhotoPickerProps) => {
  const remaining = max - value.length;

  const handleAdd = async () => {
    if (remaining <= 0) {
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 1,
      // See the note above: this does NOT strip anything from the file.
      exif: false,
    });

    if (result.canceled) {
      return;
    }

    // De-duplicated: the picker will happily return an image already in the
    // list, which would then collide on React's key and make one delete button
    // remove both copies.
    const merged = [...value, ...result.assets.map((asset) => asset.uri)];
    onChange(Array.from(new Set(merged)).slice(0, max));
  };

  const handleRemove = (uri: string) => onChange(value.filter((item) => item !== uri));

  return (
    <View>
      <Text className="mb-sm text-footnote font-medium text-text-secondary">
        {label} — up to {max}
      </Text>

      {value.length > 0 ? (
        <View className="mb-md flex-row flex-wrap gap-sm">
          {value.map((uri) => (
            <View key={uri}>
              <Image className="h-24 w-24 rounded-md" source={{ uri }} />
              <Pressable
                accessibilityLabel="Remove this photo"
                accessibilityRole="button"
                className="absolute right-xs top-xs h-6 w-6 items-center justify-center rounded-full bg-background/80"
                disabled={disabled}
                onPress={() => handleRemove(uri)}
              >
                <Text className="text-caption font-bold text-text-primary">×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <Button
        disabled={disabled || remaining <= 0}
        label={value.length === 0 ? 'Add photos' : `Add ${remaining} more`}
        onPress={() => void handleAdd()}
        variant="secondary"
      />

      {error ? <Text className="mt-xs text-caption text-danger">{error}</Text> : null}
    </View>
  );
};
