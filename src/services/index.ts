export { supabase } from './supabase';
export {
  getCurrentUser,
  getSession,
  onAuthStateChange,
  sendPasswordReset,
  signInWithEmail,
  signOut,
  signUpWithEmail,
} from './auth';
export type {
  AuthErrorCode,
  AuthFailure,
  AuthResult,
  AuthSuccess,
  Credentials,
  SignUpProfile,
} from './auth';
export {
  ALLOWED_AVATAR_MIME_TYPES,
  AVATAR_BUCKET,
  MAX_AVATAR_BYTES,
  getMyProfile,
  isValidPostalCode,
  normalisePostalCode,
  updateMyProfile,
  uploadMyAvatar,
  validateAvatar,
} from './profiles';
export type {
  AllowedAvatarMimeType,
  AvatarUploadResult,
  AvatarValidation,
  PickedImage,
  ProfileResult,
} from './profiles';
