"use client";
import { useState } from "react";
import { I18nProvider, useI18n } from "./I18nProvider";
import ConceptBoard from "./ConceptBoard";
import { diagramSamples } from "../lib/diagram-samples";
import { ANSWER_LANGUAGES } from "../lib/languages";
import type { UiMessages } from "../lib/i18n";
export default function DiagramPreview({locale,messages}:{locale:string;messages:UiMessages}) {
  return <I18nProvider initialLocale={locale} initialMessages={messages}><Preview/></I18nProvider>;
}
function Preview() {
  const {t,locale,chooseLocale,changingLocale}=useI18n();
  const [sample,setSample]=useState(0);
  const samples=diagramSamples(t);
  return <main className="diagram-preview"><header className="diagram-preview-header"><a className="brand" href="/companion">{"learnflow."}</a><label>{t("Interface language")} <select value={locale} aria-label={t("Interface language")} disabled={changingLocale} onChange={e=>void chooseLocale(e.target.value)}>{ANSWER_LANGUAGES.map(l=><option key={l.code} value={l.code}>{l.native}</option>)}</select></label></header><section className="diagram-preview-intro"><span className="lumi-diagram-eyebrow">{t("Lumi's learning board")}</span><h1>{t("See the connections. Understand the idea.")}</h1><p>{t("Explore an idea one concept at a time. Follow a branch, inspect its evidence, and connect it back to the whole picture.")}</p></section><div className="diagram-preview-layout"><div><nav className="diagram-preview-options" aria-label={t("Explore sample diagrams")}>{["Flowchart","Concept tree","Relationship graph"].map((label,i)=><button type="button" key={label} aria-pressed={sample===i} onClick={()=>setSample(i)}>{t(label)}</button>)}</nav><ConceptBoard key={`${sample}-${locale}`} visual={samples[sample]}/></div><aside className="diagram-preview-notes"><strong>{t("A guided way to explore")}</strong><p>{t("Select a node to see its explanation and supporting quote.")}</p><p>{t("Turn on Focus mode to highlight the selected concept and its immediate connections.")}</p><p>{t("Use the arrows to review each concept, or switch to Text view for a readable outline.")}</p><p className="diagram-preview-note">{t("Authored sample · not live AI")}. {t("These public examples do not use your private course. In your learning room, diagrams use the same allowed evidence as Lumi's answer.")}</p><a href="/companion">{t("Ask Lumi")}{" ↗"}</a></aside></div></main>;
}
