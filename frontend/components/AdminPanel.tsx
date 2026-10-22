"use client";
import { FormEvent, useEffect, useState } from "react";
import { I18nProvider, useI18n } from "./I18nProvider";
import { api } from "../lib/api";
import type { UiMessages } from "../lib/i18n";
type Overview = {
  counts: Record<string, number>;
  users: {
    email: string;
    display_name: string;
    role: string;
    last_active_at: string;
  }[];
  topics: { title: string; incorrect: number; attempts: number }[];
};
export default function AdminPanel(props: {
  locale: string;
  messages: UiMessages;
  setup?: boolean;
}) {
  return (
    <I18nProvider initialLocale={props.locale} initialMessages={props.messages}>
      <Panel setup={props.setup} />
    </I18nProvider>
  );
}
function Panel({ setup }: { setup?: boolean }) {
  const { t, locale, errorText } = useI18n();
  const [data, setData] = useState<Overview | null>(null);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!setup)
      api<Overview>("v1/admin/overview")
        .then(setData)
        .catch((error) =>
          setNotice(errorText(error, "Administrator access required.")),
        );
  }, [setup, errorText]);
  async function claim(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      await api("v1/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      window.location.assign("/admin");
    } catch (error) {
      setNotice(
        errorText(
          error,
          "The setup code is invalid, expired, or already used.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="app-shell admin-shell">
      <header className="topbar">
        <a className="brand" href="/">
          {"learnflow."}
        </a>
        <a className="button-secondary" href="/">
          {t("Back to learning")}
        </a>
      </header>
      <section className="study-heading">
        <div>
          <p className="eyebrow">{t("LEARNFLOW ADMINISTRATION")}</p>
          <h1>
            {t(setup ? "Claim your administrator account" : "Admin dashboard")}
          </h1>
          <p className="muted">
            {t(
              setup
                ? "Your private setup code grants administrator access to the account you are signed in with. It can only be used once."
                : "A live overview of learner activity and topics that need more support.",
            )}
          </p>
        </div>
        <a className="button-secondary" href="/login?recovery=1">
          {t("Account security")}
        </a>
      </section>
      {notice && (
        <p role="alert" className="notice">
          {t(notice)}
        </p>
      )}
      {setup ? (
        <form onSubmit={claim} className="auth-card account-form">
          <label>
            {t("Private setup code")}
            <input
              type="password"
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              minLength={32}
              maxLength={180}
            />
          </label>
          <button className="button-primary" disabled={busy}>
            {t(busy ? "Please wait…" : "Activate administrator access")}
          </button>
          <p className="muted">
            {t(
              "Never share this code. After activation, use your normal account password to sign in. Forgot password is available on the sign-in page.",
            )}
          </p>
        </form>
      ) : data ? (
        <>
          <div className="admin-metrics">
            {(
              [
                ["learners", "Learners"],
                ["courses", "Courses"],
                ["quizzes", "Quizzes"],
                ["bookmarks", "Bookmarks"],
                ["notes", "Revision notes"],
                ["interviews", "Mock interviews"],
                ["answers", "Quiz answers"],
                ["mistakes", "Mistakes"],
              ] as const
            ).map(([key, label]) => (
              <article key={key}>
                <span>{t(label)}</span>
                <strong>
                  {new Intl.NumberFormat(locale).format(data.counts[key] || 0)}
                </strong>
              </article>
            ))}
          </div>
          <div className="admin-grid">
            <section className="study-studio">
              <h2>{t("Recent learners")}</h2>
              {data.users.map((user) => (
                <div className="topic-row" key={user.email}>
                  <div>
                    <strong>{user.display_name || user.email}</strong>
                    <p className="muted">{user.email}</p>
                    <small>
                      {new Intl.DateTimeFormat(locale, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(user.last_active_at))}
                    </small>
                  </div>
                  <span className="resource-tag">
                    {t(user.role === "admin" ? "Administrator" : "Learner")}
                  </span>
                </div>
              ))}
            </section>
            <section className="study-studio">
              <h2>{t("Topics needing support")}</h2>
              {!data.topics.length && (
                <p className="muted">
                  {t(
                    "Quiz activity will reveal topics where learners need more practice.",
                  )}
                </p>
              )}
              {data.topics.map((topic) => (
                <div className="topic-row" key={topic.title}>
                  <div>
                    <strong dir="auto">{topic.title}</strong>
                    <p className="muted">
                      {t("{mistakes} mistakes in {attempts} attempts", {
                        mistakes: topic.incorrect,
                        attempts: topic.attempts,
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </section>
          </div>
        </>
      ) : (
        <p className="muted" role="status">
          {t("Loading dashboard…")}
        </p>
      )}
    </main>
  );
}
