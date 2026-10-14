# GHDraw

A hand-drawn style whiteboard for the browser, inspired by Excalidraw. No frontend build step. Local drawing works in the browser; expiring links and collaboration use a small Appwrite backend.

<p align="center"><img src="logo.svg" alt="GHDraw" width="320"></p>

## Demo videos

Watch short demos on the [GHDraw YouTube channel](https://www.youtube.com/@GHDrawofficial).

## Features

**Excalidraw-style interface**
- Floating top toolbar, a left properties panel, zoom and undo/redo controls at the bottom, and a hamburger menu
- Tools: selection, hand (pan), rectangle, diamond, ellipse, arrow, line, pen, text and eraser. Drawing tools always stay active until you choose another tool or press Esc
- Select, move, resize (with Shift to keep proportions) and multi-select with a marquee or Shift+click
- Infinite canvas: pan with the mouse wheel, `Space` + drag or the hand tool; zoom with `Ctrl` + wheel or the +/- buttons. Every time the app opens, each page starts at exactly 100% zoom (the view keeps its center, so you stay where you were); zoom changes made during a session are kept until you reload.

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
- Sticky notes, comment pins, live cursors and chat, board history, installable app (see New in v10)
- Export to PNG (2x) or animated PNG, animated GIF, MP4 / video, PDF (all pages), SVG (vector), each with a progress bar; save and open `.ghdraw` files
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
| `N` | Sticky note |
| `M` | Comment pin |
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
- Autosave serializes the element list, view and style defaults to `localStorage` on every change. During cloud collaboration all participants autosave, including received changes. Joining backs up the previous local board.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The whole app: markup, styles and drawing engine |
| `sw.js`, `manifest.webmanifest` | Installable app (PWA) and offline app shell; the icons are embedded in the manifest as data URLs |
| `logo.svg` | Wordmark ("GHDraw" in the Caveat handwriting font) |
| `LICENSE` | MIT |

## License

MIT - see [LICENSE](LICENSE).

## New in v3

- **Collaborate (ortak çizim):** start a session and send its short link. Changes sync through the free Appwrite backend about every 4 seconds, across all pages. The host does not need to stay online. Sessions expire after 48 hours; there are no live cursors or participant counts in cloud mode.
- **Shape library:** press `B` or use the toolbar button. Flowchart, UML and icon sets. Click a shape to place it, then move or edit it. Shapes come in groups: `Ctrl+G` groups, `Ctrl+Shift+G` ungroups.
- **Mobile and pen:** two-finger pinch to zoom and pan, double-tap text to edit, bottom toolbar on small screens. Stylus pressure changes pen stroke width, and while a stylus is in use, finger touches pan instead of drawing (palm rejection).

## New in v4

- X buttons close the properties panel, shape library, menu, and dialogs. Closing properties does not change the current tool; select a tool again to reopen it.
- Drawing tools always stay active after drawing. There is no lock toggle or Q shortcut; choose another tool or press Esc to return to selection. Typing names, search queries or other input fields no longer triggers tool shortcuts. Double-clicking empty space no longer unexpectedly switches to text.
- The welcome logo/text sits behind the drawing surface. Peer names and cursors have a separate overlay above drawings, images, videos and floating tool panels (dialogs remain on top).
- **Media** (the picture button or menu): upload PNG or GIF files from your device (4 MB each). Move, resize, duplicate, delete, set opacity, and reorder media and shapes. GIFs animate on the board. There is no online GIF/meme search and no third-party media API: nothing is fetched from an external provider. JPEG/WebP/video uploads are not accepted; boards saved earlier with those still open.
- Uploaded media is embedded in board data. Older boards that contained online-GIF elements (stored only as an id) show a dashed "GIF removed" placeholder, which you can delete.
- PNG export works for drawings and uploaded images/GIFs. If the board has animated GIFs, export produces `ghdraw-animated.png` (APNG, animated in browsers and most viewers; up to 10 s and 100 frames, so long GIFs are sampled). This needs a browser with the `ImageDecoder` API (Chrome/Edge, recent Safari/Firefox); otherwise the GIF exports as a single frame.

Uploaded media stays local until you create a cloud share or collaboration link; those actions upload the board and media. Cloud collaboration polls every 4 seconds while the tab is visible. Older PeerJS links are legacy only.

## Media update

The GIPHY/Wikimedia Commons online GIF search was removed; only PNG and GIF uploads from the device are accepted. Old v4 video elements still render for backward compatibility, without enabling new video uploads.

## Tool lock and grid update

- Drawing tools always stay selected after shapes, pen strokes and text entries. The lock button and Q shortcut were removed.
- The grid now has its own background canvas below all drawings and uploaded media, in both light and dark mode. Selection handles and live drawing previews remain above the scene.

## PDF export

Choose **Export > Export as PDF**, or the PDF item in the hamburger menu. Downloads `ghdraw.pdf`: the full board fitted to one custom-sized page, without the grid or editing controls. GIFs are static; for animation choose PNG/APNG instead. PDF is raster (JPEG at 95% quality), not editable vectors. Large boards are scaled to at most 8 million pixels and 8192 pixels per side to keep mobile memory use bounded. All PDF generation happens locally, with no extra dependencies.

## Animated GIF export

Choose **Export > Animated GIF** for a gallery-friendly `ghdraw-animated.gif`. Requires an uploaded animated GIF and browser GIF frame decoding (`ImageDecoder`, tested in Chrome). Full board, white background, looping, up to 10 seconds at 10 fps, longest side 480 pixels, fixed 256-color RGB332 palette. This trades color fidelity and resolution for mobile memory use; text and line art may look softer, and the simple encoder makes bigger files than optimized GIF encoders. PNG/APNG stays available for higher quality. PDF cannot animate.

## MP4 / video export

Choose **Export > MP4 / Video**. Browser-supported MP4 (H.264) is preferred; browsers that cannot record MP4 download an honestly named `.webm` instead. Requires an uploaded animated GIF and GIF frame decoding. Silent single-pass video, up to 10 seconds at 20 fps, longest side at most 1280 pixels (even dimensions), white background, no grid. Keep the tab visible during real-time recording. Encoding support varies by browser/device; no video upload was added.

## New in v7

- **Pages:** the bar at the bottom center holds page tabs. `+` adds a page, click the active tab (marked with a small arrow) for rename, duplicate, move and delete. Each page keeps its own view and undo history. Pages are saved in the browser and in `.ghdraw` files. Cloud collaboration supports adding, renaming, duplicating, deleting and switching pages. Page reordering is disabled during collaboration.
- **Smart arrows:** an arrow or line whose end is drawn on a rectangle, diamond, ellipse, text or image attaches to it and follows when the shape is moved or resized. Select an arrow and drag a round end handle to re-attach or detach it (a filled handle means attached). Moving the arrow itself detaches it. Copy, duplicate and library save keep attachments between the copied shapes.
- **Own shape library:** the **Mine** tab in the library (`B`). Select shapes, press **Save selection** (or the library button in the properties panel), name it, and reuse it any time. Hover or tap the x on a tile to delete it. Stored in the browser only (images and videos are not saved).
- **Presentation mode:** menu > Present, the play button next to the page tabs, or `Ctrl+Shift+P`. Add **presentation frames** from the menu (each frame is a 16:9 dashed box with a number); every frame is one step. Pages without frames are one step showing the whole page. Arrow keys, Space, Enter, tap (left third goes back) or swipe move between steps, Esc exits.
- **Read-only share link:** menu > Read-only link. A short `#share=...` link stores all pages and media in the backend and expires after 7 days. The viewer can pan, zoom, switch pages and present, but cannot change the stored snapshot. Copy to my board backs up the previous local board. Legacy self-contained `#view=...` links still open, but cannot expire or be revoked.
- **Export menu:** PNG / animated PNG, animated GIF, MP4 / video, PDF and SVG. A progress bar shows while a file is prepared. PNG, GIF and SVG use the current page; PDF includes every page. Video has its own page and transition settings.
  - **SVG:** real vector output with the same hand-drawn look. Fonts are referenced by name and loaded from Google Fonts when the SVG is opened online.

## New in v9

- **Page video:** choose all pages or the current page, 1-10 seconds per page, and none / fade / slide transitions (0.5 seconds). One-page boards export directly without a page/transition dialog (3 seconds). Static drawings no longer need an animated GIF to export video. Silent 1280 x 720 output, maximum 120 seconds, MP4 where supported and WebM otherwise. Embedded video/audio is excluded. Keep the tab open throughout recording.
- PPTX export and its browser-side writer have been removed. PNG / animated PNG, GIF, video, PDF and SVG remain. Presentation mode and presentation frames still work.
- Tool settings use a narrower 200 px desktop card with less spacing. On phones the card is at most 292 px wide and 32% of the viewport height, with scrolling for the remaining settings. Touch controls keep at least 44 px targets.
- The main menu is capped to the dynamic viewport height and scrolls vertically; rows keep their full height. Dialogs also fit the available screen height, including short landscape screens.
- The shape library popup is narrower too: 240 px on desktop, up to 280 px on phones.

## New in v10

- **Sticky notes** (tool `N`, toolbar): click to place a note, type text, pick one of five colors. Double-click (double-tap on a phone) to edit. Notes are normal shapes: move, resize, recolor, and arrows attach to them. The author name is shown on the note.
- **Comment pins** (tool `M`): click to drop a pin and start a thread. Click the pin to read and reply, resolve or delete it. Pins show on the canvas only; they are left out of PNG, PDF, SVG and video exports and of presentation mode. Replies in a shared board are appended on the server in arrival order, so two people replying to the same pin at the same moment both keep their message (merged by message id).
- **Live presence in shared boards:** colored avatars show who is connected, and each person's cursor with their name appears on the page they are on. A chat panel (speech bubble next to the avatars) keeps the last 100 messages of the room. Presence and chat use a small extra document per room with the same 48 hour expiry; they refresh about every 1.5 seconds with other people present (4 seconds when alone, paused in hidden tabs).
- **Smart arrows** already existed (v7): arrow ends attach to shapes and follow when the shape moves. Unchanged in v10.
- **Board history:** menu > Board history. In a shared (cloud) board the server keeps the 20 newest versions of the whole board for the room: one is taken automatically after a change when at least 2 minutes passed since the last, plus "Save a version now". Restoring saves the current state first, then replaces the shared board for everyone. The history lives in a side document of the room and expires with it (48 hours); deleting the room deletes it too. Caps: 20 versions, 8 MB compressed in total, 3 MB compressed per version (a larger version is not stored). Boards that are not shared have no server session, so they keep the 20 newest versions in this browser (IndexedDB) instead.
- **Install as an app (PWA):** `manifest.webmanifest` (icons embedded as data URLs, so no binary files) and `sw.js`. Chrome and Edge offer Install in the menu; on iOS use Share > Add to Home Screen. The app shell and fonts you already loaded open offline; cloud links, collaboration and not-yet-loaded fonts need a connection. The service worker never caches Appwrite data.

## Cloud backend

New read-only links expire 7 days after creation; collaboration rooms expire after 48 hours. The server checks its clock on reads and edits, and an hourly cleanup runs at minute 17. Expiry prevents new server access, not screenshots, downloads or copies already held in a browser. Anyone who has a room link can edit it: keep it private. A read-only link is a bearer link, not a password-protected document.

The live endpoint is `https://ghdraw-expiring-links.fra.appwrite.run/`. Database documents have no public read/write permissions. Only the function receives a short-lived scoped server key; no service key is shipped in the frontend. Function scopes: documents.read/write and databases.read/write. `/create` returns a private owner token for optional DELETE `/owner/:id`; public reads omit it. Collaboration hosts keep their revocation token in localStorage.

Bounds: 12 MB JSON board/request, 100 pages, 150 stored links for the entire project (small per-room presence, chat and history documents are not counted). Board history goes through POST `/hist/:id` (op list, save, get, restore). Room presence and chat go through POST `/live/:id` (body: cid, name, color, cursor, page, optional message), stored in a side document with the room expiry. These are not per-person accounts or a complete abuse-control system. The endpoint is public and anonymous creation can consume the free quota. Provider quota/rate limits can still stop it. No card, paid plan or paid overages were selected. A 3 MB embedded-data board passed create/read testing.

**Free-plan availability:** Appwrite pauses Free projects after 7 consecutive days without development activity in its Console. Normal user traffic does not guarantee that a project stays awake. While paused, links and rooms are inaccessible and scheduled cleanup stops; data remains and the project can be reactivated in the Console. Continuous availability requires a different hosting choice or a paid plan, neither enabled here. Policy: https://appwrite.io/changelog/entry/2026-02-20-1

The Appwrite organization and project are managed under the assistant-operated GHDraw Assistant account (`ghbot@mail.instinct.com`), not the user's personal email. Its login is in the vault as `Appwrite GHDraw (agent)`. No credentials are in this repository. The account page offers Update email with password verification (`https://appwrite.io/account`), so a later handoff can change the account email after the user selects an address. No email change or ownership transfer was performed.

### Deploying your own copy

1. Create an Appwrite project, then a private database `ghdraw` and private collection `boards` with one required string attribute `payload` (16,777,216 characters). No public collection permissions.
2. Create a Node.js 22 function, entrypoint `src/main.js`, install command `npm install`, public execute permission `any` and only the four scopes listed above.
3. Deploy `backend/package.json` and `backend/src/main.js`, and set cron `17 * * * *`.
4. Add a function domain. Replace the frontend `CLOUD_API` endpoint and the backend CORS origin with your own app URL. Do not add a persistent server key to frontend code.

### Collaboration limits

Concurrent edits to different elements are merged transactionally; editing the same element uses the last accepted update. Cloud sync is periodic, not instant. Closing while an update is pending can leave unsent edits only in local autosave. Hidden tabs pause sync and refresh on return. Page order stays fixed during a room. Undo history resets after remote changes so an old snapshot does not overwrite peers. Desktop two-tab and mobile image-share tests passed in Chromium; other browsers and large multi-user sessions remain untested.

### AI text tools 

Select one text block, then choose **Translate** or **Fix spelling & grammar** in its properties. Pick a target language, read the data warning, then use **Send & preview**. Nothing on the board changes until **Apply to text**. Undo restores the old text. If the source text or page changes while the request runs, applying the stale result is blocked. Read-only boards have no AI controls.

Only the selected text (1-2000 characters), operation and target language are sent to Groq, not the board or other elements. A random client identifier is also sent to Appwrite for limits. AI can change meaning or make mistakes, so review the preview. Do not submit personal, confidential or sensitive information. Groq's data policy: https://console.groq.com/docs/your-data . The app stores only quota counts and keyed client hashes, not AI input/output text. Provider processing and Appwrite execution metadata have their own policies; no claim of end-to-end secrecy is made.

The app has no login, so limits are **per browser installation**, not per verified person: 20 requests/day and 1 request every 3 minutes (a rolling 180-second wait between requests, also across minute boundaries and midnight UTC), plus a site-wide 200/day and 10/minute ceiling. Daily limits reset at 00:00 UTC. Appwrite custom domains omit the documented client-IP header, so the fallback uses a random browser identifier. Clearing browser storage bypasses its individual cap; it is not verified-user protection. A 429 response includes the remaining wait in seconds; the interface shows it in Turkish or English. Quota is reserved before the provider call; failed provider calls can count. Global caps protect the provider allowance even if clients reset browser identifiers. The free provider and Appwrite quotas can still stop requests.

Deployment: include `backend/src/ai.js` with `main.js`, and add `GROQ_API_KEY` as a secret function variable. Do not put the key in this file, the frontend, or GitHub. The chosen model is `openai/gpt-oss-20b`; model availability and free quotas can change. Run `node backend/src/ai.test.js` for backend validation and quota tests. A missing key fails closed, never calls a paid alternative, and never changes the drawing. No card, upgrade or paid overage is enabled.

## New in v13: templates, emoji and icons

Open the shape library (**B** or the menu) and pick a tab:

- **Templates:** flowchart, meeting notes, kanban board, mind map, SWOT and roadmap. A template inserts normal editable shapes and text, not an image. Each box and its label are grouped (double-click the label to edit the text, **Ctrl+Shift+G** to ungroup). Flowchart and mind-map connectors are bound to their shapes and follow when you move them. The view zooms out if the template is larger than the screen. Templates are inserted on the current page and sync in shared rooms like any other shapes. Labels follow the interface language when inserted.
- **Emoji:** about 190 emoji in 7 groups with search (Turkish and English words, e.g. "kalp", "heart", "ok"). Pick Small, Medium or Large (large works as a sticker). Each emoji is inserted as an editable text element, so you can resize, recolor-opacity, copy and move it like other text.
- **Icons:** the existing icon tab now also has calendar, folder, bell, flag, page, search, checkbox, play, plus, block arrow, cup and rocket. They are drawn from GHDraw's own shapes.

Everything works offline once the app shell is cached. No external service is called.

**Licensing:** emoji are plain Unicode characters. No emoji image set, icon font or third-party artwork is bundled, so there is nothing to attribute. The glyphs are drawn by your device's own emoji font (Apple, Google Noto, Segoe), so they look different per platform. Emoji your system cannot draw are hidden from the picker. Templates and icons are original to this project and covered by the MIT license.

## v14: mobile emoji picker fix

The emoji grid now stays inside the picker with its own scroll area. Columns adapt to the available width, with 44px buttons instead of eight cramped columns. The mobile emoji panel has enough room for its controls and grid; short screens can scroll the panel. New emoji use the system sans-serif/emoji fallback rather than the current handwriting font. Existing boards are not changed.

## v15: floating utility widgets

Open the menu to add a **Clock**, **Calendar**, **Timer** or **Checklist** panel. Drag a panel by its title bar; close it with the × button. The checklist is saved in this browser and is separate from the drawing board. On narrow screens, panels open with staggered title bars so one widget does not completely cover another; each panel can still be moved freely.
