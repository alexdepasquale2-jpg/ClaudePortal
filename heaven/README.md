# Heaven — The Third Cummin

A portrait phone game played lying down. The lamp is the phone. Heaven is a
soft body of light you shape with a thumb, tell a Bible story to, and watch
rest or limp. It remembers on this device only (localStorage). No account,
no network, no score.

Four verbs: hold the light (enter, give), drag the body or a part, tap a seed,
swipe down or tap "Not tonight" to leave. Hold the empty top dark for settings.

```
npm install
npm run dev     # play it
npm test        # engine rules: weather, replies, unlocks, posture, memory
npm run smoke   # three nights in headless Chromium, screenshots in shots/
npm run build   # static site in dist/
```

- `src/engine/` — pure rules: `voice.ts` (every line), `weather.ts`, `reply.ts`, `state.ts`
- `src/render/glass.ts` — 128-pixel-wide dithered canvas, four colours
- `src/main.ts` — the visit: gate, name, speaking, field, quiet, reply, leaving
