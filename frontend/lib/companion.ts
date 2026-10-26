import type { Evidence } from "../components/EvidenceSources";

export type Gesture = "idle" | "listen" | "think" | "explain" | "encourage" | "celebrate";
export type Visual = {
  kind: "concept_map" | "sequence" | "comparison";
  title: string;
  nodes: { label: string; detail: string; source_id: string; quote: string }[];
};
export type CompanionAnswer = {
  answer: string; citations: Evidence[]; session_id?: string;
  gesture: Gesture; visual: Visual | null; refusal_reason?: string | null;
  visual_status?: string; status?: string;
};
export type StudyOverview = {
  notes: unknown[]; bookmarks: unknown[]; revision_queue: unknown[];
  topics: { title: string; incorrect: number; attempts: number; correct_streak: number }[];
};
export function progressTotals(data: StudyOverview) {
  const attempts = data.topics.reduce((n, topic) => n + topic.attempts, 0);
  const mistakes = data.topics.reduce((n, topic) => n + topic.incorrect, 0);
  return { attempts, accuracy: attempts ? Math.round((attempts - mistakes) * 100 / attempts) : null,
    notes: data.notes.length, due: data.revision_queue.length,
    weak: data.topics.filter(topic => topic.incorrect > 0 && topic.correct_streak < 3).sort((a,b) => b.incorrect-a.incorrect) };
}
export function speechText(value: string) {
  return value.replace(/\[S\d+\]/g, "").replace(/https?:\/\/\S+/g, "").replace(/[#*_`]/g, "").slice(0, 4000);
}
// Commands are explicit and exact. A normal question containing 'quiz' stays a question.
export function voiceCommand(value: string) {
  const text = value.trim().toLocaleLowerCase().replace(/[.!?]+$/g, "");
  const commands: Record<string, "progress" | "visual" | "quiz" | "stop" | "close"> = {
    "show my progress": "progress", "show progress": "progress", "show the visual": "visual",
    "show visual": "visual", "start a quiz": "quiz", "open quiz": "quiz",
    "stop speaking": "stop", "close companion": "close",
  };
  return commands[text] || null;
}
export const DEMO_QUOTE = "Distance equals speed multiplied by time: d = v × t. At a speed of 3 metres per second for 4 seconds, the distance is 12 metres. Speed describes distance travelled per unit time. Time describes the duration of travel.";
export const demoAnswer: CompanionAnswer = {
  answer: "Distance is how far you travel. Multiply speed by the time spent moving: d = v × t. At 3 metres per second for 4 seconds, you travel 12 metres. A common mistake is adding speed and time; this formula multiplies them. This is an authored sample, not an answer from your private course.",
  gesture: "explain", session_id: "demo", citations: [{label: "Learnflow sample lesson", resource_name: "Learnflow sample lesson", source_type: "text", seek_seconds: null, excerpt: DEMO_QUOTE}],
  visual: {kind: "concept_map", title: "Distance = speed × time", nodes: [
    {label: "Speed · v", detail: "3 metres per second", source_id: "demo", quote: DEMO_QUOTE},
    {label: "Time · t", detail: "4 seconds", source_id: "demo", quote: DEMO_QUOTE},
    {label: "Distance · d", detail: "3 × 4 = 12 metres", source_id: "demo", quote: DEMO_QUOTE},
  ]},
};
