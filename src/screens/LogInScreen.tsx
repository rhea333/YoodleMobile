import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, TextInput } from '../components';
import type { AuthStackParamList } from '../navigation/types';
import { signInWithEmail } from '../services';
import { spacing } from '../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'LogIn'>;

/**
 * Log in.
 *
 * On success nothing is navigated: `onAuthStateChange` fires, `useSession`
 * updates, and RootNavigator swaps the whole auth stack for the main one.
 * Navigating manually here would race that swap.
 *
 * The password is held in component state and passed straight to the auth
 * service. It is never logged, never put in navigation params (which end up in
 * navigation state and crash reports), and never sent anywhere but Supabase.
 */
export const LogInScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setFormError(null);

    if (!email.trim() || !password) {
      setFormError('Please enter your email and password.');
      return;
    }

    setSubmitting(true);
    const result = await signInWithEmail({ email, password });
    setSubmitting(false);

    if (!result.ok) {
      // The service deliberately does not distinguish "unknown email" from
      // "wrong password" — that difference is an account-enumeration oracle.
      setFormError(result.message);
      return;
    }

    if (!result.session) {
      setFormError('Please confirm your email address, then log in.');
    }
  };

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
        <Text className="text-heading font-bold text-text-primary">Welcome back</Text>
        <Text className="mb-xl mt-xs text-footnote text-text-secondary">
          Log in to pick up where you left off.
        </Text>

        <View className="gap-md">
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            keyboardType="email-address"
            label="Email"
            onChangeText={setEmail}
            placeholder="you@example.com"
            returnKeyType="next"
            value={email}
          />
          <TextInput
            autoCapitalize="none"
            autoComplete="current-password"
            autoCorrect={false}
            label="Password"
            onChangeText={setPassword}
            onSubmitEditing={() => void handleSubmit()}
            placeholder="Your password"
            returnKeyType="go"
            secureTextEntry
            value={password}
          />
        </View>

        {formError ? (
          <View className="mt-lg">
            <Card padding="sm" variant="filled">
              <Text className="text-footnote text-danger">{formError}</Text>
            </Card>
          </View>
        ) : null}

        <View className="mt-xl gap-md">
          <Button
            fullWidth
            label="Log in"
            loading={submitting}
            onPress={() => void handleSubmit()}
            size="lg"
          />
          <Button
            fullWidth
            label="Create an account instead"
            onPress={() => navigation.navigate('SignUp')}
            variant="ghost"
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};
