"use client";
import "./ConceptBoard.css";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "./I18nProvider";
import type { Evidence } from "./EvidenceSources";
import type { Visual } from "../lib/companion";
import { diagramLayout, safeDiagram } from "../lib/diagram";

export default function ConceptBoard({visual, citations = [], onSeek}: {visual: Visual; citations?: Evidence[]; onSeek?: (seconds: number)=>void}) {
  const {t, citationLabel} = useI18n();
  const marker = useId().replace(/:/g, "");
  const safe = useMemo(() => safeDiagram(visual),[visual]);
  const layout = useMemo(() => safe ? diagramLayout(safe) : null,[safe]);
  const viewport = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  const [focus, setFocus] = useState(false);
  const [textOnly, setTextOnly] = useState(false);
  useEffect(() => {
    const area=viewport.current, node=layout?.nodes[selected];
    if (area && node) area.scrollTo({top:Math.max(0,node.y-70),left:Math.max(0,node.x+100-area.clientWidth/2),behavior:"instant"});
  },[layout,selected,textOnly]);
  if (!safe || !layout) return <div className="lumi-notice" role="status">{t("The visual could not be verified. The sourced answer is available above.")}</div>;
  const active = safe.nodes[selected] || safe.nodes[0];
  const activeIndex = safe.nodes.indexOf(active);
  const source = citations.find(c=>(c.chunk_id || c.source_id)===active.source_id);
  const related = new Set([active.id,...safe.edges!.filter(edge=>edge.source===active.id || edge.target===active.id).flatMap(edge=>[edge.source,edge.target])]);
  const kind = {flowchart:"Flowchart",tree:"Concept tree",graph:"Relationship graph",concept_map:"Relationship graph",sequence:"Flowchart",comparison:"Relationship graph"}[safe.kind];
  return <section className="lumi-diagram" aria-label={t("Interactive concept board")}>
    <header className="lumi-diagram-header"><div><span className="lumi-diagram-eyebrow">{"✦ "}{t(kind)}</span><h3 dir="auto">{safe.title}</h3></div><span className="lumi-diagram-count">{safe.nodes.length} {t("concepts")}</span></header>
    <div className="lumi-diagram-toolbar"><button type="button" aria-pressed={focus} onClick={()=>setFocus(!focus)}>{"◎ "}{t("Focus mode")}</button><button type="button" aria-pressed={textOnly} onClick={()=>setTextOnly(!textOnly)}>{"☷ "}{t("Text view")}</button></div>
    {textOnly ? <ol className="lumi-diagram-text">{safe.nodes.map((node,index)=><li key={node.id}><button type="button" aria-pressed={activeIndex===index} onClick={()=>setSelected(index)}><strong dir="auto">{node.label}</strong><span dir="auto">{node.detail}</span></button>{safe.edges!.filter(e=>e.source===node.id).map(edge=><p key={edge.target} dir="auto">{edge.label ? `${edge.label} → ` : "→ "}{safe.nodes.find(n=>n.id===edge.target)?.label}</p>)}</li>)}</ol> :
    <div className="lumi-diagram-scroll" ref={viewport} tabIndex={0} aria-label={t("Interactive concept board")}>
      <div className="lumi-diagram-canvas" dir="ltr" style={{width:layout.width,height:layout.height}}>
        <svg width={layout.width} height={layout.height} aria-hidden="true" className="lumi-diagram-edges"><defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8Z" fill="context-stroke"/></marker></defs>
          {safe.edges!.map((edge,index)=>{
            const a=layout.nodes.find(n=>n.id===edge.source)!,b=layout.nodes.find(n=>n.id===edge.target)!;
            const down = b.y>a.y, same = b.y===a.y;
            const x1=same ? a.x+200 : a.x+100, y1=same ? a.y+57 : down ? a.y+114 : a.y;
            const x2=same ? b.x : b.x+100, y2=same ? b.y+57 : down ? b.y : b.y+114;
            const bend = same ? Math.min(y1,y2)-72 : (y1+y2)/2;
            const backwards=b.y<a.y;
            const path=backwards ? `M${a.x} ${a.y+57} C12 ${a.y+57},12 ${b.y+57},${b.x} ${b.y+57}` : same ? `M${x1} ${y1} C${x1+36} ${bend},${x2-36} ${bend},${x2} ${y2}` : `M${x1} ${y1} C${x1} ${bend},${x2} ${bend},${x2} ${y2}`;
            const emphasized=edge.source===active.id || edge.target===active.id;
            return <g key={index} className={`${emphasized ? "is-active" : ""} ${focus&&!emphasized ? "is-muted" : ""}`}><path d={path} markerEnd={`url(#${marker})`}/>{edge.label&&<g transform={`translate(${backwards ? 83 : (x1+x2)/2},${same ? y1-52 : bend})`}><rect x="-79" y="-12" width="158" height="24" rx="8"/><text textAnchor="middle" dy="4" direction="auto">{edge.label.length>24 ? edge.label.slice(0,23)+"…" : edge.label}</text><title>{edge.label}</title></g>}</g>;
          })}
        </svg>
        {layout.nodes.map((node,index)=><button key={node.id} type="button" className={`lumi-diagram-node role-${node.role||"concept"} ${active.id===node.id ? "is-selected" : ""} ${focus&&!related.has(node.id) ? "is-muted" : ""}`} style={{left:node.x,top:node.y}} onClick={()=>setSelected(index)} aria-pressed={active.id===node.id}><span className="lumi-diagram-node-index">{String(index+1).padStart(2,"0")}<span>{node.role==="decision" ? "◇" : node.role==="example" ? "✎" : node.role==="outcome" ? "✓" : "○"}</span></span><strong dir="auto">{node.label}</strong></button>)}
      </div>
    </div>}
    <div className="lumi-diagram-navigation"><button type="button" aria-label={t("Previous concept")} disabled={activeIndex===0} onClick={()=>setSelected(activeIndex-1)}>←</button><span>{activeIndex+1} / {safe.nodes.length}</span><button type="button" aria-label={t("Next concept")} disabled={activeIndex===safe.nodes.length-1} onClick={()=>setSelected(activeIndex+1)}>→</button></div>
    <article className="lumi-diagram-insight" aria-live="polite"><span className="lumi-diagram-eyebrow">{t("Selected concept")}</span><h4 dir="auto">{active.label}</h4><p dir="auto">{active.detail}</p><details><summary>{t("Source evidence")}</summary><blockquote dir="auto">{active.quote}</blockquote>{source&&<div className="lumi-diagram-source"><span>{citationLabel(source.label)}</span>{source.seek_seconds!==null&&onSeek&&<button type="button" onClick={()=>onSeek(source.seek_seconds!)}>{t("Go to this moment")}{" ↗"}</button>}</div>}</details>{safe.edges!.filter(e=>e.source===active.id).map(edge=><details key={edge.target}><summary dir="auto">{edge.label || "→"}{" → "}{safe.nodes.find(n=>n.id===edge.target)?.label}</summary><blockquote dir="auto">{edge.quote}</blockquote></details>)}</article>
    {safe.summary&&<p className="lumi-diagram-summary" dir="auto">{safe.summary}</p>}
  </section>;
}
