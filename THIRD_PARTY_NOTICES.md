# Third-party notices

- **Hanzi Writer 3.7.3** — MIT, https://github.com/chanind/hanzi-writer. License: `public/licenses/HANZI-WRITER-LICENSE.txt`. The save validator uses a matcher extracted from the same pinned version; regenerate it with `node scripts/extract-stroke-matcher.mjs` after an upgrade.
- **Hanzi Writer Data 2.0.1** — Make Me a Hanzi / Arphic Public License, https://github.com/chanind/hanzi-writer-data and https://github.com/skishore/makemeahanzi. License: `public/licenses/ARPHICPL.TXT`. Browser clients retrieve unmodified character JSON from the pinned jsDelivr package. The test fixtures are unmodified excerpts of the same data.
- **DM Sans / Manrope** — Google Fonts, SIL Open Font License, retrieved through Google Fonts with system font fallbacks.
- Firebase JavaScript SDK: Apache-2.0, installed through npm. Dependency licenses are retained in their packages.

- **CVDICT** — Chinese–Vietnamese dictionary by Phong Phan, derived from CC-CEDICT, CC BY-SA 4.0. Original: https://github.com/ph0ngp/CVDICT. The character subset is distributed under the same license. The pinned public-fork source, transformations, and attribution are recorded in `public/data/character-dictionary/NOTICE.txt`. Full license: `public/licenses/CC-BY-SA-4.0.txt`. Regenerate with `node scripts/build-character-dictionary.mjs`.
