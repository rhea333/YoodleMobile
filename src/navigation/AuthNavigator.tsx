import {
  createNativeStackNavigator,
  type NativeStackNavigationOptions,
} from '@react-navigation/native-stack';

import { LogInScreen, SignUpScreen, WelcomeScreen } from '../screens';
import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export interface AuthNavigatorProps {
  /** Token-derived header/background styling, owned by RootNavigator. */
  screenOptions: NativeStackNavigationOptions;
}

/**
 * The unauthenticated stack. Mounted only while there is no session, so there
 * is no way to reach an app screen without one — the guard is structural
 * rather than a redirect that could be raced.
 */
export const AuthNavigator = ({ screenOptions }: AuthNavigatorProps) => (
  <Stack.Navigator screenOptions={screenOptions}>
    <Stack.Screen component={WelcomeScreen} name="Welcome" options={{ headerShown: false }} />
    <Stack.Screen component={SignUpScreen} name="SignUp" options={{ title: 'Sign up' }} />
    <Stack.Screen component={LogInScreen} name="LogIn" options={{ title: 'Log in' }} />
  </Stack.Navigator>
);
