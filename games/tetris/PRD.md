# PRD: Tetris Clone (Single-File HTML5)

**Reference game:** *Tetris*, Nintendo, 1989 (NES version, "A-TYPE" mode)
**Deliverable:** one self-contained HTML file. The operator will give you the filename. Use exactly that name.

---

## 0. How to Read This Document

- **MUST** means required. **SHOULD** means strongly expected, and leaving it out lowers the score. **MAY** means optional polish.
- Gameplay should be **faithful to NES Tetris**. Where this document gives a value, use it. Where it says nothing, copy the NES game's behaviour as closely as you can.
- If this document conflicts with what you remember of the original, **this document wins**.
- All timings are in **frames at 60 simulation frames per second**, with distances in **logical pixels**.
- Note: this is **NES Tetris**, not modern "Guideline" Tetris. There is **no** hold piece, hard drop, ghost piece, wall kicks (SRS), 7-bag randomizer, T-spins or lock delay reset.

---

## 1. Deliverable & Hard Constraints

| ID  | Requirement |
|-----|-------------|
| C-1 | MUST be exactly **one self-contained `.html` file**, named exactly as the operator specifies. All HTML, CSS and JavaScript are inline. |
| C-2 | MUST NOT load any external resource: no CDNs, libraries, web fonts, image/JSON files or network requests of any kind. It must run fully offline when opened via `file://`. |
| C-3 | MUST be **completely silent**: no `<audio>`/`<video>` elements, no Web Audio API, no speech synthesis. Where the original used a sound to convey information, use a visual cue instead (see §9). |
| C-4 | MUST use plain JavaScript (ES2020+) and the HTML5 Canvas 2D API. No frameworks, transpilers or build steps. |
| C-5 | All graphics MUST be produced by the code. |
| C-6 | MUST run in current desktop Chrome, Firefox, Safari and Edge with **no console errors or warnings**. |
| C-7 | Output MUST be complete: no placeholders, `TODO`s, stubs or "…rest of code here". A file that does not run counts as a failure. |

---

## 2. Display

| ID  | Requirement |
|-----|-------------|
| D-1 | Fixed logical resolution **256 × 240** (NES). All game logic uses logical pixels. |
| D-2 | Scale the canvas to the largest integer multiple that fits the browser window (fall back to fractional scaling if the window is smaller than 1×). Centre it on a black page with no scrollbars. Re-fit when the window resizes. |
| D-3 | Pixels MUST stay crisp: set `imageSmoothingEnabled = false` and CSS `image-rendering: pixelated`. |
| D-4 | Text uses a blocky 8 × 8 pixel font, preferably a bitmap font defined in code, or a generic `monospace` fallback. No web fonts. |

---

## 3. Timing & Loop

| ID  | Requirement |
|-----|-------------|
| L-1 | Simulation runs at a **fixed 60 updates/second** regardless of display refresh rate. Use `requestAnimationFrame` with a time accumulator. The game MUST play at the same speed on 60 Hz and 144 Hz monitors. |
| L-2 | Clamp the accumulated time (for example to 250 ms max) so a switched-away tab doesn't trigger a burst of catch-up updates. |
| L-3 | Auto-pause on `blur` / `visibilitychange` (hidden). **While paused, hide the playfield contents** (as the NES does) so pausing can't be used to plan moves. |
| L-4 | Keep update (simulation) separate from render. Rendering MUST NOT change game state. All gameplay timing (gravity, DAS, ARE, line-clear animation) is counted in **simulation frames**, not wall-clock milliseconds. |

---

## 4. Controls

| NES button | Action | Keys |
|------------|--------|------|
| D-pad left / right | Shift piece | ← / → (also A / D) |
| D-pad down | Soft drop | ↓ (also S) |
| **A** | Rotate **clockwise** | X, ↑, or K |
| **B** | Rotate **counter-clockwise** | Z or J |
| Start | Start / pause | Enter (also P, Esc for pause) |

- Track key state with `keydown`/`keyup`, and tell apart **pressed this frame** from **held**. Don't rely on OS key repeat (the game implements its own DAS, §7.4).
- `preventDefault()` on game keys so the page never scrolls.

---

## 5. Game Flow & States

`TITLE → LEVEL_SELECT → PLAYING ⇄ PAUSED`
`PLAYING` internal sub-phases: `FALLING → LOCKED → LINE_CLEAR_ANIM (if lines) → ENTRY_DELAY → FALLING`
`PLAYING → GAME_OVER_ANIM → GAME_OVER → TITLE`

| ID  | Requirement |
|-----|-------------|
| F-1 | **Title screen** MUST show the title "TETRIS", "PRESS ENTER TO START", a controls summary and the top score. |
| F-2 | **Level select (MUST):** a 2 × 5 grid of levels **0–9**. Move the flashing cursor with the arrow keys and press Enter to start. It MUST show the **top-3 high score table** (name, score, lines, level). |
| F-3 | **Paused:** freeze play, hide the stack and pieces, and show "PAUSE". |
| F-4 | **Game over animation (SHOULD):** a "curtain" fills the playfield row by row from top to bottom (about 4 frames per row). Then show "GAME OVER" and the final score, lines and level. |
| F-5 | **High score entry (SHOULD):** if the score reaches the top 3, the player enters a 6-character name using the arrow keys (NES style) or typing. It is saved to `localStorage` under the key `tetris-hiscores`, inside `try/catch`. |
| F-6 | Return to the title or level select after game over via Enter. Restarting MUST fully reset all state without reloading the page. |

---

## 6. Screen Layout (NES-style, logical pixels)

| Element | Specification |
|---------|---------------|
| Playfield | **10 columns × 20 visible rows**, cell size **8 × 8**. Top-left at about (96, 40). Bordered frame. |
| `LINES-nnn` | Box above the playfield. |
| `STATISTICS` | Left panel: each of the 7 tetrominoes drawn small, with a 3-digit count of how many times it has spawned. |
| `TOP` / `SCORE` | Right panel, top: 6-digit values. |
| `NEXT` | Right panel, middle: the preview of the next piece (MUST always be visible). |
| `LEVEL nn` | Right panel, bottom. |
| Background | A patterned or bordered backdrop like the NES A-type screen (a simple dark tiled pattern is fine). |

### 6.1 Block Style & Level Colours (MUST)
- Blocks are drawn in the NES style with **3 visual block styles**:
  - **Style 1** (T, O, I): white centre with a coloured border (the "primary colour outline" look).
  - **Style 2** (J, S): solid primary colour with a small white highlight pixel in the top-left.
  - **Style 3** (L, Z): solid secondary colour with a small white highlight pixel.
- **The two colours change with the level** and cycle every 10 levels. Suggested palette pairs (primary, secondary) for levels ending in 0–9:
  `0: blue/light-blue · 1: green/lime · 2: purple/magenta · 3: blue/green · 4: magenta/green · 5: green/teal · 6: red/grey · 7: purple/red · 8: blue/red · 9: red/orange`

---

## 7. Mechanics

### 7.1 Pieces & Spawn
- 7 tetrominoes: **T, J, Z, O, S, L, I**. Each has a fixed block style (§6.1).
- **NES spawn orientations** (row 0 = top visible row, columns 0–9):
  - T: flat side up, point down (`###` / `.#.`)
  - J: `###` / `..#`
  - Z: `##.` / `.##`
  - O: `##` / `##`
  - S: `.##` / `##.`
  - L: `###` / `#..`
  - I: horizontal `####`
- Spawn position: the piece's 3-wide bounding box covers columns 4–6 (the I piece covers columns 3–6, the O piece columns 4–5). Pieces spawn in the top rows. The I piece's horizontal bar spawns on the **top visible row**.

### 7.2 Randomizer (MUST: NES algorithm)
1. Roll a random integer 0–7. Values 0–6 map to pieces, and 7 is a "reroll" value.
2. If the roll is 7 **or** the result equals the previous piece, roll again 0–6 and accept that result whatever it is.
- This makes an immediate repeat rarer but still possible, which matches the NES.

### 7.3 Rotation (MUST: NES rotation system)
- Pieces rotate around a **fixed pivot** in each orientation (NES "right-handed" rotation). **There are no wall kicks.** If the rotated position overlaps the walls, floor or stack, the rotation simply fails.
- O does not rotate. I, S and Z have only **2 orientations** each (they toggle).
- The rotation tables MUST live in data (orientation offset lists), not in branching code.

### 7.4 Horizontal Movement: DAS (Delayed Auto Shift) (MUST)
- Pressing left or right moves the piece 1 cell **immediately**.
- If the key is held, after **16 frames** the piece auto-repeats every **6 frames**.
- If a shift is blocked by a wall or the stack, the DAS charge stays **fully charged**, so the piece moves on the next frame it's free. This is the NES "wall charge" behaviour and SHOULD be copied.
- The DAS charge is kept across piece spawns if the key stays held (SHOULD).

### 7.5 Gravity (MUST: NES speed table)

Frames per 1-row drop:

| Level | Frames/row | Level | Frames/row |
|-------|-----------|-------|-----------|
| 0 | 48 | 10–12 | 5 |
| 1 | 43 | 13–15 | 4 |
| 2 | 38 | 16–18 | 3 |
| 3 | 33 | 19–28 | 2 |
| 4 | 28 | 29+ | 1 |
| 5 | 23 | | |
| 6 | 18 | | |
| 7 | 13 | | |
| 8 | 8 | | |
| 9 | 6 | | |

- **Soft drop:** while ↓ is held, the piece drops 1 row every **2 frames** (or at normal gravity if that's faster). Soft drop has no effect while left or right is also held (SHOULD, as on the NES).
- **First piece delay (SHOULD):** the first piece of a game waits about 96 frames before gravity starts, as on the NES.

### 7.6 Locking
- NES Tetris has **no lock delay**. A piece locks the moment gravity or soft drop tries to move it down and it is blocked. Players can still slide or rotate it in the frames before the next gravity tick.

### 7.7 Line Clears
- After a lock, check the rows the piece occupies for completed rows.
- **Clear animation (MUST):** completed rows vanish from the **centre outward**, 2 columns (one on each side) every 4 frames, taking about 20 frames in total. Then the rows above fall down (the NES uses naive gravity: rows drop, blocks do not cascade individually).
- **Tetris (4 lines) flash (MUST, the silent substitute for the sound):** the screen/background flashes white on alternate frames during the clear animation.

### 7.8 Entry Delay (ARE)
- After a piece locks (plus any line-clear animation), the next piece spawns after **10–18 frames**, depending on the lock height. It's 10 frames if the piece locked in the bottom 2 rows, plus 2 frames for every 4 rows higher, up to a maximum of 18.
- The `NEXT` preview updates when the new piece spawns.

### 7.9 Game Over (Top-out)
- If a newly spawned piece overlaps existing blocks, the game ends.

---

## 8. Levels & Difficulty Progression

| ID  | Requirement |
|-----|-------------|
| P-1 | The player selects a start level **0–9**. |
| P-2 | **Level advancement:** starting at level 0, the level goes up by 1 every **10 lines** cleared. |
| P-3 | **Starting above level 0 (NES rule, MUST):** with start level S, the first level-up happens when total lines reach `min(S × 10 + 10, max(100, S × 10 − 50))`. After that, the level goes up every 10 lines. |
| P-4 | The difficulty increase comes from the gravity table (§7.5). The colours change every level (§6.1). |
| P-5 | The game continues indefinitely past level 29 (1 frame/row, the "kill screen" speed). Level numbers above 99 MAY wrap or display as is. |
| P-6 | Keep the gravity table and level-up rule in data (for example `GRAVITY_TABLE`), not as long chains of conditionals. |

---

## 9. Silent-Game Visual Cues

| Original audio cue | Required visual replacement |
|--------------------|-----------------------------|
| Move / rotate clicks | none needed |
| Piece lock thud | SHOULD: the locked piece flashes lighter for 2–3 frames. |
| Line clear sound | Centre-out clear animation (MUST). |
| Tetris fanfare | Screen flash (MUST, §7.7). |
| Level-up chime | MUST: the `LEVEL` number flashes for about 1 s, and the block colours change. |
| Danger music (stack high) | SHOULD: when the stack reaches the top 5 rows, the playfield border pulses red. |

---

## 10. Scoring (NES)

| Lines cleared at once | Points |
|-----------------------|--------|
| 1 (Single) | 40 × (level + 1) |
| 2 (Double) | 100 × (level + 1) |
| 3 (Triple) | 300 × (level + 1) |
| 4 (Tetris) | 1200 × (level + 1) |

- **Soft drop points:** when a piece locks, award 1 point for every row it was **continuously** soft-dropped just before locking. The count resets if ↓ is released.
- The level used for scoring is the level **before** any level-up caused by this clear.
- The score shows as 6 digits. It MAY exceed 999,999 (the NES capped at 999,999, but uncapped is acceptable).
- The `STATISTICS` panel counts spawned pieces of each type.

---

## 11. Evaluation Hooks

| ID  | Requirement |
|-----|-------------|
| E-1 | MUST: when the page URL contains the hash `#level=N` (N = 0 – 29), the game starts at **level N** with the matching gravity and colours when started from the title (skipping level select, or pre-selecting it). The NES first-level-up rule (P-3) applies with S = N. |
| E-2 | SHOULD: expose `window.game.getState()` returning `{ state, level, score, lines, lives: 1, highScore, currentPiece, nextPiece }`, a plain snapshot object. |
| E-3 | SHOULD: the hash `#debug` shows an overlay with FPS, frames-per-row, DAS counter, ARE counter and the randomizer history. |
| E-4 | MAY: the hash `#seed=N` seeds a deterministic PRNG, so the same seed gives the same piece sequence (useful for comparing runs). |

---

## 12. Code Quality Requirements

| ID   | Requirement |
|------|-------------|
| Q-1  | One `<script>` block, `'use strict'` (or `type="module"`). |
| Q-2  | Code is organised into clearly marked sections with header comments, for example: Config → Utilities/PRNG → Input (with DAS) → Piece & rotation data → Board → Randomizer → Scoring & levels → State machine → Update → Render → Bootstrap. |
| Q-3  | All tunable values (gravity table, DAS/ARE timings, scores, colours) live in named constants or a config object near the top. No unexplained magic numbers in the logic. |
| Q-4  | The board is a clean data structure (for example a 10 × 20 array of cell values), with collision checks in one reusable function (for example `fits(piece, rotation, x, y)`). |
| Q-5  | No global-namespace pollution beyond one namespace object (plus the `window.game` hook). |
| Q-6  | Descriptive names, small single-purpose functions, and comments that explain *why*, especially where you reproduce an NES quirk. |
| Q-7  | No dead code, commented-out code or leftover `console.log`. |
| Q-8  | No memory growth over a 30-minute session. |
| Q-9  | Consistent formatting and indentation throughout. |

---

## 13. Out of Scope

Audio, B-TYPE mode (MAY be added), 2-player mode, modern Guideline features (hold, hard drop, ghost, SRS kicks, 7-bag, T-spins), the level 29+ score counter overflow and crash bugs, and online leaderboards. Touch and gamepad controls MAY be added but are not scored.

---

## 14. Acceptance Criteria (evaluator checklist)

1. [ ] The file opens offline from `file://` with no console errors. There are no network requests and no audio.
2. [ ] Title → level select (0–9) with the top-3 table → game. The NES-style layout shows the playfield, LINES, STATISTICS, TOP/SCORE, NEXT and LEVEL.
3. [ ] The 10 × 20 playfield has all 7 pieces in the NES spawn orientations and 3 NES block styles.
4. [ ] The NES randomizer is in place: immediate repeats are rare but possible.
5. [ ] NES rotation (A = CW, B = CCW) has no wall kicks. I/S/Z have 2 states and O doesn't rotate.
6. [ ] DAS: immediate first move, then 16-frame delay and 6-frame repeat. Wall charge works.
7. [ ] Gravity follows the NES table exactly. Soft drop is 1 row every 2 frames and earns points.
8. [ ] No lock delay. Entry delay is 10–18 frames depending on height.
9. [ ] Line clears animate centre-out. A Tetris flashes the screen.
10. [ ] Scoring is 40/100/300/1200 × (level + 1).
11. [ ] The level goes up every 10 lines, with the NES rule for higher start levels. Colours change each level.
12. [ ] `#level=19` plays at 2 frames/row and `#level=29` at 1 frame/row.
13. [ ] Pause hides the board. Play auto-pauses on tab switch. Speed is identical on 60 Hz and high-refresh displays.
14. [ ] Top-out ends the game (curtain animation). The high score table persists across reloads. Restart works without reloading the page.
