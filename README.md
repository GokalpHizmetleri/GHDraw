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
- Export to PNG (2x), or to an animated PNG (APNG) when the board has animated GIFs; save and open `.ghdraw` files
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
- Autosave serializes the element list, view and style defaults to `localStorage` on every change. During a collaboration session the host also saves edits received from guests (debounced 400 ms, and on tab hide/close), so a host reload keeps them. Guests do not autosave.

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
- **Media** (the picture button or menu): upload PNG or GIF files from your device (4 MB each). Move, resize, duplicate, delete, set opacity, and reorder media and shapes. GIFs animate on the board. There is no online GIF/meme search and no third-party media API: nothing is fetched from an external provider. JPEG/WebP/video uploads are not accepted; boards saved earlier with those still open.
- Uploaded media is embedded in board data. Older boards that contained online-GIF elements (stored only as an id) show a dashed "GIF removed" placeholder, which you can delete.
- PNG export works for drawings and uploaded images/GIFs. If the board has animated GIFs, export produces `ghdraw-animated.png` (APNG, animated in browsers and most viewers; up to 10 s and 100 frames, so long GIFs are sampled). This needs a browser with the `ImageDecoder` API (Chrome/Edge, recent Safari/Firefox); otherwise the GIF exports as a single frame.

Media uploads stay in your browser or travel directly to collaborators. No automatic polling. Collaboration still requires the host page to remain open; existing public PeerJS/no-TURN limits apply.

## Media update

The GIPHY/Wikimedia Commons online GIF search was removed; only PNG and GIF uploads from the device are accepted. Old v4 video elements still render for backward compatibility, without enabling new video uploads.
