import { useState } from 'react';
import { Image, Text, View } from 'react-native';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

export interface AvatarProps {
  /** Falls back to initials when absent or when the image fails to load. */
  uri?: string;
  name?: string;
  size?: AvatarSize;
  testID?: string;
}

const box: Record<AvatarSize, string> = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-14 w-14',
  xl: 'h-20 w-20',
};

const initialsSize: Record<AvatarSize, string> = {
  sm: 'text-caption',
  md: 'text-footnote',
  lg: 'text-bodyLarge',
  xl: 'text-heading',
};

/** "Marie-Claude Tremblay" -> "MT"; a single name yields one letter. */
const toInitials = (name: string): string =>
  name
    .split(/[\s-]+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

export const Avatar = ({ uri, name, size = 'md', testID }: AvatarProps) => {
  const [failed, setFailed] = useState(false);
  const initials = name ? toInitials(name) : '';
  const showImage = Boolean(uri) && !failed;

  return (
    <View
      accessibilityLabel={name ? `Avatar for ${name}` : 'Avatar'}
      accessibilityRole="image"
      className={[
        'items-center justify-center overflow-hidden rounded-full',
        'bg-primary-subtle',
        'border border-border',
        box[size],
      ].join(' ')}
      testID={testID}
    >
      {showImage && uri ? (
        <Image
          className="h-full w-full"
          onError={() => setFailed(true)}
          resizeMode="cover"
          source={{ uri }}
        />
      ) : (
        <Text
          className={['font-semibold text-primary-subtle-foreground', initialsSize[size]].join(' ')}
        >
          {initials}
        </Text>
      )}
    </View>
  );
};
