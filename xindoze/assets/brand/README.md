# Xindoze brand

Palette from SPEC §14.

| Name | Hex | Use |
|---|---|---|
| Obsidian | `#0B0D10` | Ground, launcher background, splash |
| Bone | `#EDE8DF` | Centromere, monochrome mark, wordmark on dark |
| Ember | `#FF5A1F` | One chromatid (revolution) |
| Biolume | `#2BF5C4` | The other chromatid (evolution) |

The mark is an X drawn as a chromosome: two chromatids joined at the centre. Ember takes the left chromatid, Biolume the right. A Bone bead is the centromere. Bands are gaps in the arms and stay off the join. At 32 px and below the bands and the bead drop out and the arms get thicker (`logo-small.svg`, `mark-small.svg`).

## Files

| File | What it is |
|---|---|
| `mark.svg` | Colour mark, transparent |
| `mark-mono.svg` | Bone mark, transparent |
| `mark-small.svg` | Simplified mark for 32 px and below |
| `adaptive-foreground.svg` | Same mark, padded into the Android adaptive safe circle (66 of 108) |
| `logo.svg` | Mark on an Obsidian rounded tile |
| `logo-small.svg` | Simplified tile |
| `wordmark.svg` | Mark plus "Xindoze" in Inter SemiBold outlines, Bone |
| `wordmark-light.svg` | Same outlines in Obsidian, for the light theme |
| `OFL.txt` | Inter's SIL Open Font License |
| `render-icons.sh` | Rebuilds every launcher PNG, `icon.ico`, `icon.icns` and the splash |

`render-icons.sh` writes the Tauri icon set in place:

`xindoze/shell/src-tauri/icons/`

including `icons/android/mipmap-*/` at the existing pixel sizes. It does not change `ic_launcher.xml` or `ic_launcher_background.xml` (`#0B0D10`).

## Android splash (for the companion)

Tauri copies `src-tauri/icons/android/` into `gen/android/app/src/main/res/` when the Android project is generated. These are the resources to keep:

| Path under `xindoze/shell/src-tauri/icons/android/` | Role |
|---|---|
| `drawable/ic_splash.xml` | SplashScreen animated icon. Ember and Biolume on a transparent ground, inside the safe circle |
| `drawable/splash.xml` | Pre-12 full-screen fallback: Obsidian layer with the icon centred |
| `drawable/ic_stat_xindoze.xml` | White status-bar silhouette for the foreground-service notification |
| `drawable-nodpi/xindoze_splash.png` | 1080×2400 bitmap fallback |
| `values/colors_splash.xml` | `@color/xindoze_splash_background` = `#0B0D10` |
| `values/themes_splash.xml` | `Theme.Xindoze.Splash` using `windowBackground` |
| `values-v31/themes_splash.xml` | Same theme name. `windowSplashScreenBackground`, `windowSplashScreenAnimatedIcon`, `windowSplashScreenIconBackgroundColor` |

Set the launch activity's theme to `Theme.Xindoze.Splash`. The system shows the icon on Obsidian, then the app theme takes over.

A full PNG set (720×1280, 1080×1920, 1080×2400, 1440×2560, 1440×3120) lives in `xindoze/assets/brand/splash/`. The same XML is mirrored under `splash/res/` for a copy that does not depend on the Tauri tree.

Monochrome launcher mipmaps are not in the current Tauri icon tree. Use `mark-mono.svg` if a themed icon is added later; do not rename the existing mipmaps.

## Canvas icons

`xindoze/shell/ui/src/lib/icons/` is a 24 px stroke set. Every stroke is `currentColor`. Import `Icon` from `src/lib/icons`. Names: summon, mic (and voice), send, stream, rewind, pulse, egress, egress-out, hive, warden, charter, journal, cortex, settings, prime, forge, files, notes, web, sight, ancestors, allow, ask, deny, observe, act, commit. `genomeIcon` maps a Seed Bank id to its icon. The Intent Bar uses summon and send. Rewind uses rewind. The header mark is the same chromosome as `mark.svg`.
