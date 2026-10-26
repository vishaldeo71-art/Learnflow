"use client";
import { useEffect, useState } from "react";
import { I18nProvider, useI18n } from "./I18nProvider";
import { ANSWER_LANGUAGES } from "../lib/languages";
import type { UiMessages } from "../lib/i18n";

export default function AccountForm(props: {
  locale: string;
  messages: UiMessages;
  next: string;
  recovery: boolean;
  confirmationError: boolean;
  initialMode?: string;
  initialNotice?: string;
}) {
  return (
    <I18nProvider initialLocale={props.locale} initialMessages={props.messages}>
      <Form {...props} />
    </I18nProvider>
  );
}
function Form({
  next,
  recovery,
  confirmationError,
  initialMode,
  initialNotice,
}: {
  next: string;
  recovery: boolean;
  confirmationError: boolean;
  initialMode?: string;
  initialNotice?: string;
}) {
  const { t, locale, chooseLocale, languageName, changingLocale } = useI18n();
  const [mode, setMode] = useState(recovery ? "password" : initialMode || "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const restore = () => setBusy(false);
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);
  const [notice, setNotice] = useState(
    confirmationError
      ? "The confirmation link expired. Request a new password reset or try signing in."
      : initialNotice || "",
  );
  function generatePassword() {
    const values = crypto.getRandomValues(new Uint32Array(24));
    const alphabet =
      "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%-_";
    setPassword(
      Array.from(values, (value) => alphabet[value % alphabet.length]).join(""),
    );
    setShowPassword(true);
    setNotice(
      "Save this generated password in your password manager before continuing.",
    );
  }
  return (
    <main className="auth-shell">
      <header className="topbar">
        <a href="/" className="brand">
          {"learnflow."}
        </a>
        <div className="interface-language">
          <label htmlFor="login-language">{t("Interface language")}</label>
          <select
            id="login-language"
            value={locale}
            disabled={changingLocale}
            onChange={(e) => void chooseLocale(e.target.value)}
          >
            {ANSWER_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.native} · {languageName(l.code)}
              </option>
            ))}
          </select>
        </div>
      </header>
      <section className="auth-layout">
        <div className="auth-intro">
          <p className="eyebrow">{t("YOUR LEARNING STUDIO")}</p>
          <h1>{t("Turn understanding into lasting progress.")}</h1>
          <p>
            {t(
              "Keep your learning guide, adaptive quizzes, saved explanations, and revision plan together in one private account.",
            )}
          </p>
          <div className="auth-feature">
            {"✳ "}
            {t("Practice weak topics with evidence from your course.")}
          </div>
          <div className="auth-feature">
            {"↗ "}
            {t("Return to the exact video moment or document page.")}
          </div>
          <div className="auth-feature">
            {"◷ "}
            {t("Know what to revise next.")}
          </div>
        </div>
        <div className="auth-card">
          <p className="eyebrow">{t("WELCOME TO LEARNFLOW")}</p>
          <h2>
            {t(
              mode === "signup"
                ? "Create your account"
                : mode === "reset"
                  ? "Reset your password"
                  : mode === "password"
                    ? "Choose a new password"
                    : "Welcome back",
            )}
          </h2>
          <p className="muted">
            {t("Your study progress is saved securely across devices.")}
          </p>
          {notice && (
            <p role="status" className="notice">
              {t(notice)}
            </p>
          )}
          <form action="/auth/action" method="post" onSubmit={() => {setBusy(true); setNotice("");}} className="account-form">
            <input type="hidden" name="action" value={mode}/>
            <input type="hidden" name="next" value={next}/>
            {mode === "signup" && (
              <label>
                {t("Your name")}
                <input
                  autoComplete="name"
                  name="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  required
                />
              </label>
            )}
            {mode !== "password" && (
              <label>
                {t("Email address")}
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  maxLength={254}
                />
              </label>
            )}
            {mode !== "reset" && (
              <>
                <label>
                  {t("Password")}
                  <input
                    type={showPassword ? "text" : "password"}
                    name="password"
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={mode === "login" ? 1 : 10}
                    maxLength={128}
                    required
                  />
                </label>
                <div className="study-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {t(showPassword ? "Hide password" : "Show password")}
                  </button>
                  {mode !== "login" && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={generatePassword}
                    >
                      {t("Generate secure password")}
                    </button>
                  )}
                </div>
              </>
            )}
            <button className="button-primary full-width" disabled={busy}>
              {t(
                busy
                  ? "Please wait…"
                  : mode === "signup"
                    ? "Create account"
                    : mode === "reset"
                      ? "Send reset link"
                      : mode === "password"
                        ? "Save new password"
                        : "Sign in",
              )}
            </button>
          </form>
          {mode === "login" ? (
            <div className="auth-links">
              <button
                className="text-button"
                onClick={() => {
                  setMode("signup");
                  setNotice("");
                }}
              >
                {t("Create an account")}
              </button>
              <button
                className="text-button"
                onClick={() => {
                  setMode("reset");
                  setNotice("");
                }}
              >
                {t("Forgot password?")}
              </button>
            </div>
          ) : (
            <button
              className="text-button"
              onClick={() => {
                setMode("login");
                setNotice("");
              }}
            >
              {t("Back to sign in")}
            </button>
          )}
          <p className="muted">
            {t("Administrator? Sign in, then use your private setup code.")}
          </p>
          <a href="/admin/setup" className="text-button">
            {t("Administrator setup")}
          </a>
          <p><a href="/companion" className="text-button">{t("Meet Lumi, your learning companion")}{" ↗"}</a></p>
        </div>
      </section>
    </main>
  );
}
