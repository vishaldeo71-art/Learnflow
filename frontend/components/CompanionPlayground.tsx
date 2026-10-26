"use client";
import { I18nProvider, useI18n } from "./I18nProvider";
import LumiCompanion from "./LumiCompanion";
import { ANSWER_LANGUAGES } from "../lib/languages";
import type { UiMessages } from "../lib/i18n";
export default function CompanionPlayground({locale,messages}: {locale: string; messages: UiMessages}) {
  return <I18nProvider initialLocale={locale} initialMessages={messages}><Playground/></I18nProvider>;
}
function Playground() {
  const {t,locale,chooseLocale,changingLocale} = useI18n();
  return <main className="lumi-playground"><header className="lumi-playground-top"><a href="/" className="brand">{"learnflow."}</a><label>{t("Interface language")}<select aria-label={t("Interface language")} value={locale} disabled={changingLocale} onChange={e => void chooseLocale(e.target.value)}>{ANSWER_LANGUAGES.map(language => <option key={language.code} value={language.code}>{language.native}</option>)}</select></label></header><div className="lumi-playground-layout"><section className="lumi-playground-intro"><p className="eyebrow">{t("MEET YOUR STUDY COMPANION")}</p><h1>{t("A little company.")}<br/><em>{t("A clearer concept.")}</em></h1><p>{t("Meet Lumi: a curious companion that listens, explains, and helps ideas take shape.")}</p><div className="lumi-playground-features"><span>{"◉ "}{t("Voice questions")}</span><span>{"◈ "}{t("Interactive 3D concepts")}</span><span>{"✧ "}{t("Encouragement that moves")}</span></div><a className="button-primary" href="/login">{t("Open my learning room")}{" ↗"}</a><p className="lumi-preview-note">{t("This is an authored playground. Sign in for Gemini answers grounded in your own course and your real study progress.")}</p></section><LumiCompanion demo/></div></main>;
}
