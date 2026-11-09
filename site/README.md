# defuss-storage website

The project site at <https://storage.defuss.org>: live OPFS demos, benchmark
charts, install instructions and API overview, in English and German. It builds
into the repository's `docs/` folder, which GitHub Pages serves.

## Commands

Run from the repository root unless noted. The site imports the package from
`../dist`, so the package build comes first; `make site` does both.

```sh
make site                 # build the package, then the site into docs/
cd site && bun run dev    # Vite dev server with the same localization and data
node site/e2e/serve.mjs   # serve docs/ like GitHub Pages at http://127.0.0.1:4173/
make test                 # includes the site's unit tests (bun run test in site/)
make e2e                  # includes the site suite in Chromium, Firefox and WebKit
```

`bun run test:e2e` in `site/` runs the browser suite against an existing build.
It writes `output/site-e2e.json` and screenshots to `output/site/`.

## Editing content

- Text lives in `src/strings.ts`, English and German side by side. The page
  source `index.html` holds empty placeholders (`data-t="key"`, and
  `data-ta="aria-label:key"` for attributes). The build fails on a missing key,
  an unused key, a forbidden character (dashes, typographic quotes, ellipses,
  arrows, bullets) or a promotional word from `build/prose.ts`.
- Numbers in the copy are `{{slots}}` filled from `benchmarks/` and `dist/` by
  `build/figures.ts`; a new `make bench` changes copy and charts together.
- Code windows are `<div class="mockup-code" data-snippet="id"></div>`
  placeholders; the code is in `src/snippets.ts` and Shiki highlights it at
  build time.
- Messages that scripts write at runtime (demo status lines, chart labels) are
  in `src/messages.ts`.
- `llms.txt` is the template of the published `/llms.txt` for coding agents:
  `{{snippet:id}}` pulls code from `src/snippets.ts`, `{{slots}}` pull the
  measured figures, and the same prose rules apply.

See [ARCH.md](ARCH.md) for how the pieces fit together.
