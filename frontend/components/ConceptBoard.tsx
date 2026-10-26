"use client";
import { useRef, useState, type CSSProperties } from "react";
import { useI18n } from "./I18nProvider";
import type { Visual } from "../lib/companion";

export default function ConceptBoard({visual}: {visual: Visual}) {
  const {t} = useI18n();
  const [rotation, setRotation] = useState({x: -12, y: -14});
  const [selected, setSelected] = useState(0);
  const [flat, setFlat] = useState(false);
  const drag = useRef<{x: number; y: number; rx: number; ry: number} | null>(null);
  const active = visual.nodes[selected] || visual.nodes[0];
  return <section className="lumi-board" aria-label={t("Interactive concept board")}>
    <div className="lumi-board-heading"><strong>{visual.title}</strong><button type="button" className="lumi-text-button" aria-pressed={flat} onClick={() => setFlat(!flat)}>{t(flat ? "3D view" : "Flat view")}</button></div>
    <div className={`lumi-board-viewport ${flat ? "lumi-board-flat" : ""}`} onPointerDown={event => {
      if (flat || (event.target instanceof Element && event.target.closest("button"))) return;
      drag.current = {x: event.clientX, y: event.clientY, rx: rotation.x, ry: rotation.y};
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={event => {
      const start = drag.current;
      if (start) setRotation({x: Math.max(-45, Math.min(45, start.rx-(event.clientY-start.y)*.2)), y: Math.max(-65,Math.min(65,start.ry+(event.clientX-start.x)*.25))});
    }} onPointerUp={() => {drag.current = null;}} onPointerCancel={() => {drag.current = null;}}>
      <div className={`lumi-board-world lumi-board-${visual.kind}`} style={{"--board-rx": `${rotation.x}deg`, "--board-ry": `${rotation.y}deg`} as CSSProperties}>
        <div className="lumi-board-floor"/>
        {visual.nodes.map((node, index) => <button type="button" key={`${node.label}-${index}`} className={`lumi-node ${selected === index ? "lumi-node-active" : ""}`} style={{"--node-i": index, "--node-count": visual.nodes.length, "--node-x": `${((index % Math.min(3,visual.nodes.length))+.5)*100/Math.min(3,visual.nodes.length)}%`, "--node-y": `${25+Math.floor(index/3)*85}px`} as CSSProperties} onClick={() => setSelected(index)} aria-pressed={selected === index}>
          <span>{String(index+1).padStart(2,"0")}</span><strong>{node.label}</strong>
        </button>)}
      </div>
    </div>
    {!flat && <div className="lumi-rotate-controls"><label>{t("Rotate board")}<input aria-label={t("Rotate board")} type="range" min="-65" max="65" value={rotation.y} onChange={e => setRotation({...rotation,y:Number(e.target.value)})}/></label><button type="button" className="lumi-text-button" onClick={() => setRotation({x:-12,y:-14})}>{t("Reset view")}</button></div>}
    {active && <div className="lumi-node-detail"><strong>{active.label}</strong><p>{active.detail}</p><details><summary>{t("Source evidence")}</summary><blockquote>{active.quote}</blockquote></details></div>}
    <small>{t("A concept illustration, not a physical simulation.")}</small>
  </section>;
}
