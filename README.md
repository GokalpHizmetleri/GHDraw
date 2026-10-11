# GHDraw

A hand-drawn style whiteboard for the browser, inspired by Excalidraw. No build step, no dependencies, no backend - open it and start sketching.

<p align="center"><img src="logo.svg" alt="GHDraw" width="320"></p>

## Features

**Excalidraw-style interface**
- Floating top toolbar, a left properties panel, zoom and undo/redo controls at the bottom, and a hamburger menu
- Tools: selection, hand (pan), rectangle, diamond, ellipse, arrow, line, pen, text and eraser, with a "keep tool active" lock
- Select, move, resize (with Shift to keep proportions) and multi-select with a marquee or Shift+click
- Infinite canvas: pan with the mouse wheel, `Space` + drag or the hand tool; zoom with `Ctrl` + wheel or the +/- buttons

**Styling**
- Stroke and background colors (Excalidraw palette plus a custom color picker)
- Fill styles: hachure, cross-hatch, solid
- Stroke width, stroke style (solid, dashed, dotted), sloppiness (hand-drawn wobble), sharp or round edges, opacity
- Layers: send to back, backward, forward, to front
- Duplicate, delete, copy and paste

**Text with lots of fonts**
- 32 font families in the text tool, each previewed in its own typeface in the picker: handwriting (Caveat, Kalam, Patrick Hand, Shantell Sans, Playpen Sans, Pangolin, Caveat Brush, Amatic SC), script and display (Marck Script, Kaushan Script, Dancing Script, Pacifico, Merienda, Courgette, Lobster, Bangers, Fredoka, Baloo 2, Righteous, Comfortaa), sans (Nunito, Poppins, Inter, Rubik, Oswald), serif (Playfair Display, Lora, Merriweather, Abril Fatface, Cinzel) and mono (Courier Prime, Roboto Mono, Space Mono)
- Font size presets plus a free size field, left/center/right alignment, multi-line text
- Double-click any text to edit it. Turkish characters (ğ ş İ ı ö ü ç) render correctly

**Everything else**
- Dark mode, optional grid, Turkish and English interface (switch in the menu)
- Export to PNG (2x), save and open `.ghdraw` files
- Autosave to `localStorage`
- Zero build: a single `index.html` with vanilla JS. Works from `file://`, any static host, or Vercel

> The fonts load from Google Fonts, so the font picker needs an internet connection. Without it, text falls back to a system font.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `V` / `1` | Selection |
| `H` | Hand (pan) |
| `R` / `2` | Rectangle |
| `D` / `3` | Diamond |
| `O` / `4` | Ellipse |
| `A` / `5` | Arrow |
| `L` / `6` | Line |
| `P` / `7` | Pen |
| `T` / `8` | Text |
| `E` / `9` | Eraser |
| `Q` | Keep the tool active after drawing |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `Ctrl+D` | Duplicate |
| `Ctrl+C` / `Ctrl+V` | Copy / paste |
| `Ctrl+A` | Select all |
| `Ctrl+S` / `Ctrl+O` | Save / open a `.ghdraw` file |
| `Ctrl+Shift+E` | Export PNG |
| `Delete` | Delete selection |
| `Shift` while drawing | Square, circle or 45 degree line |
| `?` | Show shortcuts |

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

- Every shape, stroke and text block is a plain JSON element in an ordered list (the order is the layer order).
- Rendering draws that list onto a `<canvas>` through a pan/zoom transform. Undo and redo move through snapshots of the list, and export draws the same list onto an offscreen canvas.
- The hand-drawn look comes from drawing each shape twice with small seeded offsets, so lines wobble without flickering between frames.
- Autosave serializes the element list, view and style defaults to `localStorage` on every change.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The whole app: markup, styles and drawing engine |
| `logo.svg` | Wordmark ("GHDraw" in the Caveat handwriting font) |
| `LICENSE` | MIT |

## License

MIT - see [LICENSE](LICENSE).

## New in v3

- **Collaborate (ortak çizim):** top right "Collaborate" button, Start session, send the link. Everyone who opens it draws on the same canvas live, with named cursors. It runs peer-to-peer (WebRTC) and uses the free public PeerJS signaling server, so there is nothing to set up on Vercel: no env vars, no accounts, no database. The session lives while the host keeps the page open; drawings are not stored on any server. Very strict corporate networks may block direct connections (no TURN relay is configured).
- **Shape library:** press `B` or use the toolbar button. Flowchart, UML and icon sets. Click a shape to place it, then move or edit it. Shapes come in groups: `Ctrl+G` groups, `Ctrl+Shift+G` ungroups.
- **Mobile and pen:** two-finger pinch to zoom and pan, double-tap text to edit, bottom toolbar on small screens. Stylus pressure changes pen stroke width, and while a stylus is in use, finger touches pan instead of drawing (palm rejection).

## New in v4

- X buttons close the properties panel, shape library, menu, and dialogs. Closing properties does not change the current tool; select a tool again to reopen it.
- Tools stay active by default after drawing. You can still turn off the lock (Q) for one-shot drawing. Typing names, search queries or other input fields no longer triggers tool shortcuts. Double-clicking empty space no longer unexpectedly switches to text.
- The welcome logo/text sits behind the drawing surface. Peer names and cursors have a separate overlay above drawings, images, videos and floating tool panels (dialogs remain on top).
- **Media / GIF** (the picture button or menu): upload photos, PNG, JPEG, WebP, GIF, MP4 or WebM. Move, resize, duplicate, delete, set opacity, and reorder mixed media and shapes. GIFs animate on the board. Select a video to play/pause it, toggle sound or restart. Video playback is local to each participant, not synchronized.
- **Online GIF browser:** search Wikimedia Commons, preview results, click to add. No account or API key is needed. English search terms usually work best. This is a free-media catalog, not the full Tenor/Giphy meme catalog. Source and license links appear for each result; credit is retained in saved element data. Follow the source license when sharing or exporting.
- Media is embedded in the board data, including online GIFs, so `.ghdraw` files and collaboration carry it along. Each uploaded/imported media file is limited to **4 MB** to keep peer transfers and browser storage manageable. If browser storage fills, a warning asks you to save a `.ghdraw` file. Video support depends on the browser's codecs (H.264 MP4 is a safe choice).
- PNG export captures one GIF frame and the current video frame, not an animation/video. Remote images that disallow cross-origin export show an error rather than silently failing.

Media is stored in your browser or shared directly with peers. Online GIF searches and downloads contact Wikimedia Commons. The existing peer-to-peer collaboration limits still apply: host page open, public signaling service, no TURN relay and no durable server storage.
