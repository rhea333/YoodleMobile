import {
  createNativeStackNavigator,
  type NativeStackNavigationOptions,
} from '@react-navigation/native-stack';

import {
  ChatScreen,
  CompleteProfileScreen,
  DesignSystemScreen,
  EditJobScreen,
  HomeScreen,
  JobDetailScreen,
  LeaveReviewScreen,
  MakeOfferScreen,
  MyJobsScreen,
  NotificationsScreen,
  OffersScreen,
  PayoutSetupScreen,
  PostJobScreen,
  ProfileScreen,
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
    <Stack.Screen
      component={MakeOfferScreen}
      name="MakeOffer"
      options={{ title: 'Make an offer' }}
    />
    <Stack.Screen component={OffersScreen} name="Offers" options={{ title: 'Offers' }} />
    <Stack.Screen
      component={ChatScreen}
      name="Chat"
      options={({ route }) => ({ title: route.params.otherUserName })}
    />
    <Stack.Screen
      component={NotificationsScreen}
      name="Notifications"
      options={{ title: 'Notifications' }}
    />
    <Stack.Screen component={PayoutSetupScreen} name="PayoutSetup" options={{ title: 'Payouts' }} />
    <Stack.Screen component={ProfileScreen} name="Profile" options={{ title: 'Profile' }} />
    <Stack.Screen
      component={LeaveReviewScreen}
      name="LeaveReview"
      options={{ title: 'Leave a review' }}
    />
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
