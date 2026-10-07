# Canvas assets

Art, sounds, and type for the Xindoze shell (SPEC §3.11, §7, §14). Everything here is offline. Nothing loads from a CDN.

Every X in this folder uses the brand chromatids: Ember `M236 176C552 330 552 694 236 848`, Biolume `M788 176C472 330 472 694 788 848`, round caps, Bone bead. The mark files themselves stay in `xindoze/assets/brand/`.

## Fonts

`shell/ui/src/main.ts` imports `fonts.css`. Vite is allowed to read `xindoze/assets`, and it bundles the woff2 files.

| File | Use |
|---|---|
| `fonts/fonts.css` | `@font-face` for `Inter Variable`, `Inter`, `JetBrains Mono Variable`, `JetBrains Mono` |
| `fonts/inter/*.woff2` | Inter 4.1 variable, roman and italic, OFL-1.1 |
| `fonts/jetbrains-mono/*.woff2` | JetBrains Mono 2.304, weights 400–700 plus italics, OFL-1.1 |

`app.css` already points `--font-ui` and `--font-mono` at those family names. Weight 550 resolves to SemiBold and 650 to Bold.

## Wallpaper and boot

`main.ts` also imports `canvas/wallpaper.css`, which paints `wallpaper-dark.svg` or `wallpaper-light.svg` on `body` (Obsidian and Bone swap with the color scheme).

| File | Use |
|---|---|
| `canvas/wallpaper-dark.svg`, `canvas/wallpaper-light.svg` | Scalable desktop field |
| `canvas/wallpaper-*-1920x1080.png`, `canvas/wallpaper-*-3840x2160.png` | Same field for an OS wallpaper picker |
| `canvas/wallpaper.css` | The shell import |
| `canvas/boot/boot.svg` | Dark by default. A Biolume cell pinches and splits into the brand X in about 2.5s, then “Xindoze has evolved.” Reduced motion shows the final frame. Light inverts Obsidian and Bone |
| `canvas/boot/boot.html` | Standalone boot screen |
| `canvas/make_canvas.py` | Regenerates the wallpaper SVG and PNG files |

Regenerate wallpapers with `python3 xindoze/assets/canvas/make_canvas.py`.

## Empty states and Pulse

The shell imports these SVGs directly.

| File | Where it shows |
|---|---|
| `canvas/empty/stream.svg` | Stream, before the first intent |
| `canvas/empty/canvas.svg` | Canvas pane, when no Organism is open |
| `canvas/empty/journal.svg` | Journal, when nothing has been recorded |
| `canvas/pulse/egress-idle.svg` | Zero-egress mark while Pulse has not reported |
| `canvas/pulse/egress-active.svg` | Zero egress, runtime alive (Biolume, breathes) |
| `canvas/pulse/egress-alert.svg` | Something left the device (Ember) |
| `canvas/pulse/model-shimmer.svg` | Model loading |
| `canvas/pulse/model-shimmer.css` | Same sweep as a CSS class `.xindoze-model-shimmer` |

Import from a Svelte file under `shell/ui/src/components`:

```svelte
import streamEmpty from '../../../../assets/canvas/empty/stream.svg';
```

## Sounds

Synthesized in `sounds/make_sounds.py` (numpy, then ffmpeg Vorbis). No samples. Mono, 44.1 kHz, peak −3 dBFS. OGG is what the shell plays; WAV is the fallback. The set is about 640 KB.

| Cue | When the shell plays it |
|---|---|
| `boot-evolved` | Canvas start. One tone divides into a fifth |
| `intent-open` / `intent-close` | Summon key (`Ctrl+Alt+Space`) focuses or leaves the Intent Bar |
| `intent-sent` | An intent is sent |
| `task-done` | The intent finishes |
| `notification` | The intent returns before it is done |
| `warden-ask` | A commit needs confirmation |
| `deny` | A step was denied or declined |
| `rewind` | Rewind |
| `hive-connect` / `hive-disconnect` | A Hive peer comes online or drops |
| `error` | A call fails. Soft, not a blame sound |

`shell/ui/src/lib/cues.ts` bundles the OGG files and exposes `cue(name)`. Regenerate with `python3 xindoze/assets/sounds/make_sounds.py`.

## Contact sheet

`canvas/preview.png` is the art sheet (wallpapers, boot frame, empty states, Pulse).
