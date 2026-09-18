import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, TextInput } from '../components';
import type { AuthStackParamList } from '../navigation/types';
import { isValidPostalCode, normalisePostalCode, signUpWithEmail } from '../services';
import { spacing } from '../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignUp'>;

/** Minimum enforced here; Supabase's own policy is the real floor. */
const MIN_PASSWORD_LENGTH = 8;

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
  postalCode?: string;
}

/**
 * Sign up: email, password, name, postal code.
 *
 * The name and postal code are sent as sign-up metadata rather than written
 * from here. The `on_auth_user_created` trigger materialises them into
 * `profiles`, which works whether or not email confirmation is enabled — a
 * client-side write would be denied by RLS when there is no session yet.
 *
 * The full postal code is sent; the database stores it with column-level SELECT
 * revoked and exposes only the FSA ("M5V") to other users.
 */
export const SignUpScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};

    if (!name.trim()) {
      errors.name = 'Please enter your name.';
    } else if (name.trim().length > 80) {
      errors.name = 'Please use 80 characters or fewer.';
    }

    if (!email.trim()) {
      errors.email = 'Please enter your email.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = 'That does not look like an email address.';
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      errors.password = `Please use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }

    if (!postalCode.trim()) {
      errors.postalCode = 'Please enter your postal code.';
    } else if (!isValidPostalCode(postalCode)) {
      errors.postalCode = 'Please enter a valid Canadian postal code, like M5V 2T6.';
    }

    return errors;
  };

  const handleSubmit = async () => {
    setFormError(null);
    setNotice(null);

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    const normalised = normalisePostalCode(postalCode);
    if (!normalised) {
      setFieldErrors({ postalCode: 'Please enter a valid Canadian postal code, like M5V 2T6.' });
      return;
    }

    setSubmitting(true);
    const result = await signUpWithEmail(
      { email, password },
      { displayName: name, postalCode: normalised },
    );
    setSubmitting(false);

    if (!result.ok) {
      setFormError(result.message);
      return;
    }

    if (!result.session) {
      // Email confirmation is enabled on the project: there is no session yet,
      // so the navigator will not swap. Say so rather than appearing to hang.
      setNotice(
        'Check your email for a confirmation link, then log in. Your profile is already saved.',
      );
      return;
    }

    // Session exists — RootNavigator swaps to the main stack on its own, and
    // the onboarding screen is reached from there.
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
        <Text className="text-heading font-bold text-text-primary">Create your account</Text>
        <Text className="mb-xl mt-xs text-footnote text-text-secondary">
          Your postal code helps us show you jobs nearby. Neighbours only ever see the first three
          characters.
        </Text>

        <View className="gap-md">
          <TextInput
            autoCapitalize="words"
            autoComplete="name"
            error={fieldErrors.name}
            label="Your name"
            onChangeText={setName}
            placeholder="Alex Tremblay"
            value={name}
          />
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            error={fieldErrors.email}
            keyboardType="email-address"
            label="Email"
            onChangeText={setEmail}
            placeholder="you@example.com"
            value={email}
          />
          <TextInput
            autoCapitalize="none"
            autoComplete="new-password"
            autoCorrect={false}
            error={fieldErrors.password}
            helperText={`At least ${MIN_PASSWORD_LENGTH} characters.`}
            label="Password"
            onChangeText={setPassword}
            placeholder="Choose a password"
            secureTextEntry
            value={password}
          />
          <TextInput
            autoCapitalize="characters"
            autoComplete="postal-code"
            autoCorrect={false}
            error={fieldErrors.postalCode}
            helperText="Only the first three characters are shown to others."
            label="Postal code"
            maxLength={7}
            onChangeText={setPostalCode}
            placeholder="M5V 2T6"
            value={postalCode}
          />
        </View>

        {formError ? (
          <View className="mt-lg">
            <Card padding="sm" variant="filled">
              <Text className="text-footnote text-danger">{formError}</Text>
            </Card>
          </View>
        ) : null}

        {notice ? (
          <View className="mt-lg">
            <Card padding="sm" variant="filled">
              <Text className="text-footnote text-text-primary">{notice}</Text>
            </Card>
          </View>
        ) : null}

        <View className="mt-xl gap-md">
          <Button
            fullWidth
            label="Create account"
            loading={submitting}
            onPress={() => void handleSubmit()}
            size="lg"
          />
          <Button
            fullWidth
            label="I already have an account"
            onPress={() => navigation.navigate('LogIn')}
            variant="ghost"
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};
