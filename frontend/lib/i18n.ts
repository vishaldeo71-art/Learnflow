import ANSWER_LANGUAGES from "./languages.json" with { type: "json" };

export type UiMessages = Record<string, string>;
export type UiParams = Record<string, string | number>;
export type UiText = string | { key: string; params?: UiParams };
export const UI_LANGUAGE_KEY = "learnflow-ui-language";
export function validUiLocale(value?: string | null): string {
  return ANSWER_LANGUAGES.some((language) => language.code === value) ? value! : "en";
}
export function uiDirection(locale: string): "ltr" | "rtl" {
  return ANSWER_LANGUAGES.find((language) => language.code === locale)?.direction === "rtl" ? "rtl" : "ltr";
}
export function translateUi(messages: UiMessages, text: UiText, values: UiParams = {}): string {
  const key = typeof text === "string" ? text : text.key;
  const params = typeof text === "string" ? values : text.params || {};
  let template = messages[key] || key;
  // Rubric skills are dynamic course data, while the surrounding sentence is UI.
  const skills = key.match(/^You connected answers to role-relevant skills: (.+)\.$/);
  if (skills) {
    template = messages["You connected answers to role-relevant skills: {skills}."] || key;
    return template.replace("{skills}", skills[1]);
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] === undefined ? match : String(params[name]));
}
