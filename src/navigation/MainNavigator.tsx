import {
  createNativeStackNavigator,
  type NativeStackNavigationOptions,
} from '@react-navigation/native-stack';

import {
  CompleteProfileScreen,
  DesignSystemScreen,
  EditJobScreen,
  HomeScreen,
  JobDetailScreen,
  MyJobsScreen,
  PostJobScreen,
} from '../screens';
import type { MainStackParamList } from './types';

const Stack = createNativeStackNavigator<MainStackParamList>();

export interface MainNavigatorProps {
  /**
   * When true, onboarding is shown first. Decided by RootNavigator from the
   * profile row rather than a local flag, so reinstalling the app does not
   * re-prompt someone who already completed it.
   */
  needsOnboarding: boolean;
  /** Token-derived header/background styling, owned by RootNavigator. */
  screenOptions: NativeStackNavigationOptions;
}

/**
 * The authenticated stack. HomeScreen is untouched from phase 1 — it is only
 * registered here.
 */
export const MainNavigator = ({ needsOnboarding, screenOptions }: MainNavigatorProps) => (
  <Stack.Navigator
    initialRouteName={needsOnboarding ? 'CompleteProfile' : 'Home'}
    screenOptions={screenOptions}
  >
    <Stack.Screen
      component={CompleteProfileScreen}
      name="CompleteProfile"
      options={{ title: 'Your profile' }}
    />
    <Stack.Screen component={HomeScreen} name="Home" options={{ title: 'Yoodle' }} />
    <Stack.Screen component={JobDetailScreen} name="JobDetail" options={{ title: 'Job' }} />
    <Stack.Screen component={PostJobScreen} name="PostJob" options={{ title: 'Post a job' }} />
    <Stack.Screen component={MyJobsScreen} name="MyJobs" options={{ title: 'My jobs' }} />
    <Stack.Screen component={EditJobScreen} name="EditJob" options={{ title: 'Edit job' }} />
    {/*
      Dev-only. `__DEV__` is false in a release bundle, so this route is simply
      absent there rather than merely unlinked — there is nothing to deep-link
      or guess your way into.
    */}
    {__DEV__ ? (
      <Stack.Screen
        component={DesignSystemScreen}
        name="DesignSystem"
        options={{ title: 'Design system (dev)' }}
      />
    ) : null}
  </Stack.Navigator>
);
