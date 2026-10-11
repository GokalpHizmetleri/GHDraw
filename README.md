# GHDraw

A hand-drawn style whiteboard for the browser, inspired by Excalidraw. No build step, no dependencies, no backend - open it and start sketching.

![GHDraw](logo.svg)

## Features

- **Pen** - freehand drawing with round, pressure-friendly strokes
- **Shapes** - lines, arrows, rectangles and ellipses rendered with a subtle hand-drawn wobble
- **Text** - click anywhere and type; multi-line supported
- **Eraser** - stroke-based erasing (click or drag across strokes)
- **Colors and stroke size** - six-color palette plus a size slider
- **Undo / redo** - full history with `Ctrl+Z` / `Ctrl+Shift+Z` (or `Ctrl+Y`)
- **Export to PNG** - downloads your board at 2x resolution
- **Autosave** - the board persists in `localStorage`, so a refresh never loses your sketch
- **Zero build** - a single `index.html` with vanilla JS. Works from `file://`, any static host, or Vercel

## Keyboard shortcuts

| Key | Tool |
| --- | --- |
| `P` | Pen |
| `L` | Line |
| `A` | Arrow |
| `R` | Rectangle |
| `O` | Ellipse |
| `T` | Text |
| `E` | Eraser |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |

## Run locally

Clone the repo and open `index.html` in your browser. That's it.

```bash
git clone https://github.com/GokalpHizmetleri/GHDraw.git
cd GHDraw
open index.html   # or just double-click the file
```

## Deploy to Vercel

The repo is a plain static site, so Vercel deploys it with zero configuration:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/GokalpHizmetleri/GHDraw)

Or manually:

1. Go to [vercel.com/new](https://vercel.com/new) and import this repository.
2. Leave every setting at its default (no framework preset, no build command).
3. Click **Deploy**. Vercel serves `index.html` at the root.

Every push to `main` after that redeploys automatically.

## How it works

- Every stroke, shape and text block is stored as a plain JSON operation in an ordered list.
- Rendering replays that list onto a `<canvas>`. Undo is a pop, redo is a push, export replays the same list onto an offscreen canvas.
- The hand-drawn look comes from drawing each shape twice with small deterministic offsets ("rough" passes), so strokes wobble without flickering between frames.
- Autosave serializes the operation list to `localStorage` on every change.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The whole app: markup, styles and drawing engine |
| `logo.svg` | Wordmark ("GHDraw" in the Caveat handwriting font) |
| `LICENSE` | MIT |

## License

MIT - see [LICENSE](LICENSE).
