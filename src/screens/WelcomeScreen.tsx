import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge, Button } from '../components';
import type { AuthStackParamList } from '../navigation/types';
import { spacing } from '../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'Welcome'>;

/** First screen an unauthenticated visitor sees. */
export const WelcomeScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-1 justify-between bg-background"
      style={{
        paddingTop: insets.top + spacing['2xl'],
        paddingBottom: insets.bottom + spacing.xl,
        paddingHorizontal: spacing.lg,
      }}
    >
      <View>
        <Badge label="Your neighbourhood" tone="accent" withDot />
        <Text className="mt-lg text-display font-bold text-text-primary">Yoodle</Text>
        <Text className="mt-md text-bodyLarge text-text-secondary">
          Odd jobs, done by the people next door. Post what you need, or earn a bit helping out
          nearby.
        </Text>
      </View>

      <View className="gap-md">
        <Button fullWidth label="Sign up" onPress={() => navigation.navigate('SignUp')} size="lg" />
        <Button
          fullWidth
          label="Log in"
          onPress={() => navigation.navigate('LogIn')}
          size="lg"
          variant="secondary"
        />
        <Text className="mt-sm text-center text-caption text-text-muted">
          By continuing you agree to Yoodle’s terms and privacy policy.
        </Text>
      </View>
    </View>
  );
};
