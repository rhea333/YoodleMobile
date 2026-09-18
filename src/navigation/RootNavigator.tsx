import {
  DarkTheme,
  NavigationContainer,
  type Theme as NavigationTheme,
} from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';

import { useProfileQuery, useSession, useTheme } from '../hooks';
import { fontWeights, typography } from '../theme';
import { AuthNavigator } from './AuthNavigator';
import { MainNavigator } from './MainNavigator';

/**
 * Maps our tokens onto React Navigation's own theme so headers match the app.
 * Built from `DarkTheme` because Yoodle is dark-first and single-theme.
 */
const buildNavigationTheme = (colors: ReturnType<typeof useTheme>['colors']): NavigationTheme => ({
  ...DarkTheme,
  dark: true,
  colors: {
    ...DarkTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.surface,
    text: colors.textPrimary,
    border: colors.border,
    notification: colors.danger,
  },
});

/**
 * Chooses between the auth and main stacks based on the session.
 *
 * Only one stack is mounted at a time, so an app screen is unreachable without
 * a session by construction rather than by redirect. The screens themselves
 * never navigate across the boundary — signing in or out changes the session,
 * and this component re-renders.
 */
export const RootNavigator = () => {
  const { colors } = useTheme();
  const { session, loading } = useSession();
  const userId = session?.user.id;

  // Drives whether onboarding is shown first. Only meaningful once signed in;
  // the hook is disabled while userId is undefined.
  const profileQuery = useProfileQuery(userId);

  const screenOptions = {
    headerStyle: { backgroundColor: colors.surface },
    headerTintColor: colors.textPrimary,
    headerTitleStyle: {
      fontSize: typography.bodyLarge.fontSize,
      fontWeight: fontWeights.semibold,
    },
    contentStyle: { backgroundColor: colors.background },
  };

  // Wait for the persisted session before choosing a stack, or an already
  // signed-in user sees the welcome screen flash on every cold start. Also
  // wait for the first profile load, so onboarding is not shown to someone who
  // has already completed it.
  const resolving = loading || (Boolean(userId) && profileQuery.isPending);

  if (resolving) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <StatusBar style="light" />
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  // A profile with neither photo nor bio has not been through onboarding.
  // Derived from the row rather than a local flag so it survives reinstalls.
  const profile = profileQuery.data;
  const needsOnboarding = Boolean(session) && !profile?.avatar_url && !profile?.bio;

  return (
    <NavigationContainer theme={buildNavigationTheme(colors)}>
      <StatusBar style="light" />
      {session ? (
        <MainNavigator key="main" needsOnboarding={needsOnboarding} screenOptions={screenOptions} />
      ) : (
        <AuthNavigator key="auth" screenOptions={screenOptions} />
      )}
    </NavigationContainer>
  );
};
