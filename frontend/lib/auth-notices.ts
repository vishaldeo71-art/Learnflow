export const AUTH_NOTICES: Record<string,string> = {
  confirmation: "Check your email to confirm your account, then sign in.",
  reset_sent: "If an account exists, a password reset link will arrive by email.",
  invalid_credentials: "Sign-in failed. Check your email address and password.",
  email_not_confirmed: "Sign-in failed. Check your email, password, and email confirmation.",
  unavailable: "The sign-in service is temporarily unavailable. Please retry.",
  invalid_password: "Use a password with 10 to 128 characters.",
  failed: "The account request could not be completed. Please retry later.",
};
export function accountNotice(value: unknown) {
  return typeof value === "string" && Object.hasOwn(AUTH_NOTICES,value) ? AUTH_NOTICES[value] : "";
}
export function loginNotice(code?: string) {
  return code === "invalid_credentials" || code === "email_not_confirmed" ? code : "unavailable";
}
export function accountMode(value: unknown) {
  return value === "signup" || value === "reset" ? value : "login";
}
