import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validUiLocale, type UiMessages } from "./i18n";
const catalogs = new Map<string,UiMessages>();
export async function loadUiMessages(raw: string): Promise<UiMessages> {
  const locale=validUiLocale(raw);
  const cached=catalogs.get(locale);if(cached)return cached;
  const data = await readFile(join(process.cwd(),"public","locales",`${locale}.json`),"utf8").catch(() => readFile(join(process.cwd(),"frontend","public","locales",`${locale}.json`),"utf8"));
  const messages=JSON.parse(data) as UiMessages;
  catalogs.set(locale,messages);return messages;
}
