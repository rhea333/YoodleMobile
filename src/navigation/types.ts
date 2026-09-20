/**
 * Route maps. The app has two mutually exclusive stacks: `AuthStack` when
 * there is no session, `MainStack` once there is. RootNavigator picks between
 * them, so no route in one is ever reachable from the other.
 */

/** Shown only when there is NO active session. */
export type AuthStackParamList = {
  Welcome: undefined;
  SignUp: undefined;
  LogIn: undefined;
};

/** Shown only when a session EXISTS. */
export type MainStackParamList = {
  CompleteProfile: undefined;
  Home: undefined;
  /** `jobId` only — the screen fetches the job rather than being handed it, so
   *  a stale list row cannot render as if it were current. */
  JobDetail: { jobId: string };
  /** The multi-step posting wizard. */
  PostJob: undefined;
  /** The poster's own listings, in every status. */
  MyJobs: undefined;
  /** Edit an existing job. Location is not editable here; see the screen. */
  EditJob: { jobId: string };
  /**
   * DEV ONLY. The component gallery kept from phase 1. `MainNavigator`
   * registers this route only when `__DEV__`, so navigating to it in a release
   * build is not possible — the route does not exist there.
   */
  DesignSystem: undefined;
};

/**
 * Kept for compatibility with anything importing the phase-1 name.
 * `Home` still resolves; the rest of the main stack is in MainStackParamList.
 */
export type RootStackParamList = MainStackParamList;

declare global {
  namespace ReactNavigation {
    // Makes useNavigation() route names type-safe app-wide without extra generics.
    // The empty body is the interface-merging pattern React Navigation documents;
    // extending two maps means it is no longer an empty-object type, so the
    // suppression this needed in phase 1 is no longer required.
    interface RootParamList extends AuthStackParamList, MainStackParamList {}
  }
}
