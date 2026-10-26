/** Public login messages follow Supabase's error code, never guesses about the account. */
export function loginErrorMessage(error: {code?: string}) {
  if (error.code === "email_not_confirmed")
    return "Sign-in failed. Check your email, password, and email confirmation.";
  if (error.code === "invalid_credentials")
    return "Sign-in failed. Check your email address and password.";
  return "The sign-in service is temporarily unavailable. Please retry.";
}
