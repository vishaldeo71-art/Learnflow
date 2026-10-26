import type { Gesture } from "../lib/companion";
import { useId } from "react";

/** Original vector mascot, with articulated arms and state-driven expressions. */
export default function LumiAvatar({gesture = "idle", speaking = false}: {gesture?: Gesture; speaking?: boolean}) {
  const id = useId().replace(/:/g, "");
  const shell = `url(#${id}-shell)`, visor = `url(#${id}-visor)`, core = `url(#${id}-core)`;
  return <svg className={`lumi-avatar lumi-${gesture}${speaking ? " lumi-speaking" : ""}`} viewBox="0 0 240 250" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-shell`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#c0ffe4"/><stop offset=".5" stopColor="#50c6a1"/><stop offset="1" stopColor="#147b66"/></linearGradient>
      <linearGradient id={`${id}-visor`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#254b51"/><stop offset="1" stopColor="#102e35"/></linearGradient>
      <radialGradient id={`${id}-core`}><stop stopColor="#edffb6"/><stop offset="1" stopColor="#85e7b5"/></radialGradient>
    </defs>
    <ellipse className="lumi-shadow" cx="120" cy="231" rx="49" ry="8" fill="#234b3b" opacity=".12"/>
    <g className="lumi-float">
      <g className="lumi-leg" fill={shell} stroke="#216958" strokeWidth="3"><rect x="88" y="186" width="25" height="31" rx="11"/><rect x="128" y="186" width="25" height="31" rx="11"/></g>
      <g className="lumi-arm lumi-arm-left" fill={shell} stroke="#216958" strokeWidth="3"><rect x="62" y="144" width="20" height="39" rx="10"/><g className="lumi-hand-left"><rect x="57" y="174" width="26" height="27" rx="11"/><path d="M63 181v8m7-10v11m7-8v6" fill="none" strokeWidth="2"/></g></g>
      <rect x="79" y="131" width="83" height="70" rx="28" fill={shell} stroke="#216958" strokeWidth="3"/>
      <path d="M92 146q28 12 57 0" stroke="#e2ffed" strokeWidth="4" fill="none" opacity=".7"/>
      <circle className="lumi-heart" cx="120" cy="170" r="16" fill={core} stroke="#4aa781" strokeWidth="2"/>
      <path d="M114 176q-2-13 13-17 1 14-13 17m1-1 9-11" stroke="#276f55" strokeWidth="2" fill="#62ba85"/>
      <g className="lumi-arm lumi-arm-right" fill={shell} stroke="#216958" strokeWidth="3"><rect x="159" y="143" width="20" height="35" rx="10"/><g className="lumi-forearm"><rect x="158" y="166" width="22" height="24" rx="10"/><g className="lumi-hand-right"><rect x="154" y="182" width="28" height="28" rx="12"/><path d="M161 188v11m7-12v12m7-10v8" fill="none" strokeWidth="2"/></g></g></g>
      <g className="lumi-head">
        <path d="M120 48V29" stroke="#216958" strokeWidth="5" strokeLinecap="round"/>
        <path d="M120 31q-17-15-4-21 16 1 14 12-3 7-10 9" fill="#a9df71" stroke="#468b57" strokeWidth="2"/>
        <rect x="43" y="77" width="22" height="36" rx="11" fill="#63bd9e" stroke="#216958" strokeWidth="3"/><rect x="177" y="77" width="22" height="36" rx="11" fill="#63bd9e" stroke="#216958" strokeWidth="3"/>
        <rect x="54" y="45" width="134" height="105" rx="42" fill={shell} stroke="#216958" strokeWidth="3"/>
        <path d="M73 64q34-19 83-6" fill="none" stroke="#e8fff4" strokeWidth="6" strokeLinecap="round" opacity=".75"/>
        <rect x="68" y="66" width="106" height="66" rx="26" fill={visor} stroke="#388d79" strokeWidth="2"/>
        <g className="lumi-eyes" fill="#b4ffdc"><rect className="lumi-eye" x="88" y="85" width="11" height="20" rx="5.5"/><rect className="lumi-eye" x="141" y="85" width="11" height="20" rx="5.5"/></g>
        <path className="lumi-smile" d="M110 111q10 10 21 0" fill="none" stroke="#b4ffdc" strokeWidth="3" strokeLinecap="round"/>
        <g className="lumi-voice-bars" stroke="#b4ffdc" strokeWidth="3" strokeLinecap="round"><path d="M111 112v5"/><path d="M119 109v11"/><path d="M127 112v5"/></g>
        <ellipse cx="85" cy="113" rx="7" ry="3" fill="#64c3b1" opacity=".35"/><ellipse cx="155" cy="113" rx="7" ry="3" fill="#64c3b1" opacity=".35"/>
      </g>
    </g>
    <g className="lumi-sparkles" fill="#d3a043"><path d="m40 44 3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/><path d="m200 132 3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/></g>
  </svg>;
}
