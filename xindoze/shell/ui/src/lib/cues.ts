/** UI sounds. OGG is primary; the matching WAV sits beside it as a fallback. */

const files = import.meta.glob('../../../../assets/sounds/ogg/*.ogg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const cues: Record<string, string> = {};
for (const [path, url] of Object.entries(files)) {
  const name = path.split('/').pop()?.replace(/\.ogg$/, '');
  if (name) cues[name] = url;
}

export function cue(name: string): void {
  const url = cues[name];
  if (!url || typeof Audio === 'undefined') return;
  const audio = new Audio(url);
  audio.volume = 0.8;
  void audio.play().catch(() => {});
}
