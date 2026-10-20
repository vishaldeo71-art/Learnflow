"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { translateUi, validUiLocale, uiDirection, UI_LANGUAGE_KEY, type UiMessages, type UiParams, type UiText } from "../lib/i18n";

type I18nValue = { locale: string; changingLocale: boolean; localeError: boolean; chooseLocale(code: string): Promise<boolean>; t(text: UiText, params?: UiParams): string; languageName(code: string): string; errorText(error: unknown, fallback: string): string; citationLabel(label: string): string };
const Context = createContext<I18nValue | null>(null);
export function I18nProvider({initialLocale, initialMessages, children}: {initialLocale: string; initialMessages: UiMessages; children: ReactNode}) {
  const [locale, setLocale] = useState(initialLocale);
  const [messages, setMessages] = useState(initialMessages);
  const [changingLocale, setChangingLocale] = useState(false);
  const [localeError, setLocaleError] = useState(false);
  const catalogs = useRef<Record<string,UiMessages>>({[initialLocale]:initialMessages});
  const requestVersion = useRef(0);
  const t = useCallback((text: UiText, params?: UiParams) => translateUi(messages,text,params), [messages]);
  const chooseLocale = useCallback(async (raw: string) => {
    const code = validUiLocale(raw), version = ++requestVersion.current;
    setChangingLocale(true);setLocaleError(false);
    try {
      let catalog = catalogs.current[code];
      if (!catalog) {
        const response = await fetch(`/locales/${code}.json`, {cache:"no-cache"});
        if (!response.ok) throw new Error("Catalog unavailable");
        catalog = await response.json();
        if (!catalog || typeof catalog !== "object" || typeof catalog["Interface language"] !== "string") throw new Error("Invalid catalog");
        catalogs.current[code] = catalog;
      }
      if (version !== requestVersion.current) return false;
      setMessages(catalog);setLocale(code);
      try { window.localStorage.setItem(UI_LANGUAGE_KEY,code); } catch { /* Optional storage. */ }
      document.cookie = `${UI_LANGUAGE_KEY}=${encodeURIComponent(code)};path=/;max-age=31536000;samesite=lax`;
      return true;
    } catch { if (version === requestVersion.current) setLocaleError(true);return false; }
    finally { if (version === requestVersion.current) setChangingLocale(false); }
  }, []);
  useEffect(() => {
    document.documentElement.lang=locale;document.documentElement.dir=uiDirection(locale);
    document.title=t("Learnflow | AI Learning Assistant");
  }, [locale,t]);
  const value = useMemo<I18nValue>(() => ({locale,changingLocale,localeError,chooseLocale,t,
    languageName(code) { try {return new Intl.DisplayNames([locale],{type:"language"}).of(code) || code;} catch {return code;} },
    errorText(error,fallback) {const key=error instanceof Error ? error.message : "";return messages[key] ? key : fallback;},
    citationLabel(label) {return label.replace(/^AI video notes \(approximate\)/,t("AI video notes (approximate)")).replace(/^Video /,t("Video")+" ").replace(/ · page /," · "+t("page")+" ").replace(/ · slide /," · "+t("slide")+" ");}
  }),[locale,changingLocale,localeError,chooseLocale,t,messages]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useI18n() {const value=useContext(Context);if(!value)throw new Error("Missing interface language provider");return value;}
