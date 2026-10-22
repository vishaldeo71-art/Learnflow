/** Count advancing media time while playing; seeks and wall-clock time do not count. */
export type PlaybackSample = { time: number; playing: boolean };
export function watchedAdvance(
  previous: PlaybackSample | null,
  current: PlaybackSample,
): number {
  if (!previous?.playing || !current.playing) return 0;
  const delta = current.time - previous.time;
  return Number.isFinite(delta) && delta > 0 && delta <= 3 ? delta : 0;
}
