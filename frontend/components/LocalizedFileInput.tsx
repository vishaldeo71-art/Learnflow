"use client";
import {useRef} from "react";
import {useI18n} from "./I18nProvider";
export default function LocalizedFileInput({accept,file,onChange,label}:{accept:string;file:File|null;onChange(file:File|null):void;label:string}) {
  const input=useRef<HTMLInputElement>(null);const {t}=useI18n();
  return <div className="localized-file-input"><input ref={input} type="file" accept={accept} aria-label={label} hidden onChange={(event)=>{onChange(event.target.files?.[0] || null);event.target.value="";}}/><button type="button" className="button-secondary" onClick={()=>input.current?.click()} aria-label={label}>{t("Choose file")}</button><span dir="auto">{file?.name || t("No file selected")}</span></div>;
}
