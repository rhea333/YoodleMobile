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
  /** Make or amend an offer on someone else's job. */
  MakeOffer: { jobId: string };
  /** Offers in both directions: received on your jobs, and ones you made. */
  Offers: undefined;
  /**
   * One conversation about one job. `otherUserName` is passed for the header
   * only — every read is still scoped by `jobId` + `otherUserId` and checked
   * against RLS, so a wrong name cannot widen what is visible.
   */
  Chat: { jobId: string; otherUserId: string; otherUserName: string };
  /** In-memory feed of what arrived since the app opened. */
  Notifications: undefined;
  /** Stripe Connect onboarding, so a worker can be paid. */
  PayoutSetup: undefined;
  /**
   * Somebody's public profile — rating, bio and the reviews written about them.
   * `userId` only; everything shown is what the 0008 column grants return.
   */
  Profile: { userId: string };
  /**
   * Rate the other party on a completed job.
   *
   * `jobId` ONLY, deliberately. Who is being reviewed is derived from the job
   * and its accepted offer, never passed in — a route param naming the reviewee
   * would be a caller-supplied claim about who they worked with.
   */
  LeaveReview: { jobId: string };
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
