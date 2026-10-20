import languages from "./languages.json" with { type: "json" };

export const ANSWER_LANGUAGES = languages;
export const ANSWER_LANGUAGE_KEY = "learnflow-answer-language";
export function validAnswerLanguage(value: string | null): string {
  return value === "auto" || languages.some((item) => item.code === value) ? value! : "auto";
}
export function answerDirection(code: string | undefined): "rtl" | "ltr" | "auto" {
  return languages.find((item) => item.code === code)?.direction === "rtl" ? "rtl" : code && code !== "auto" ? "ltr" : "auto";
}
