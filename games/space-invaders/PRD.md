# PRD: Space Invaders Clone (Single-File HTML5)

**Reference game:** *Space Invaders*, Taito, 1978 (arcade, upright cabinet)
**Deliverable:** one self-contained HTML file. The operator will give you the filename. Use exactly that name.

---

## 0. How to Read This Document

- **MUST** means required. **SHOULD** means strongly expected, and leaving it out lowers the score. **MAY** means optional polish.
- Gameplay should be **faithful to the original arcade game**. Where this document gives a value, use it. Where it says nothing, copy the original's behaviour as closely as you can.
- If this document conflicts with what you remember of the original, **this document wins**.
- All speeds and timings assume **60 simulation frames per second**, with distances in **logical pixels**.

---

## 1. Deliverable & Hard Constraints

| ID  | Requirement |
|-----|-------------|
| C-1 | MUST be exactly **one self-contained `.html` file**, named exactly as the operator specifies. All HTML, CSS and JavaScript are inline. |
| C-2 | MUST NOT load any external resource: no CDNs, libraries, web fonts, image/JSON files or network requests of any kind. It must run fully offline when opened via `file://`. |
| C-3 | MUST be **completely silent**: no `<audio>`/`<video>` elements, no Web Audio API, no speech synthesis. Where the original used a sound to convey information, use a visual cue instead (see §9). |
| C-4 | MUST use plain JavaScript (ES2020+) and the HTML5 Canvas 2D API. No frameworks, transpilers or build steps. |
| C-5 | All graphics MUST be produced by the code, either as drawn primitives or as pixel-art defined in inline arrays/strings and rendered to offscreen canvases at startup. |
| C-6 | MUST run in current desktop Chrome, Firefox, Safari and Edge with **no console errors or warnings**. |
| C-7 | Output MUST be complete: no placeholders, `TODO`s, stubs or "…rest of code here". A file that does not run counts as a failure. |

---

## 2. Display

| ID  | Requirement |
|-----|-------------|
| D-1 | Fixed logical resolution **224 × 256** (portrait, like the original's rotated monitor). All game logic uses logical pixels. |
| D-2 | Scale the canvas to the largest integer multiple that fits the browser window (fall back to fractional scaling if the window is smaller than 1×). Centre it on a black page with no scrollbars. Re-fit when the window resizes. |
| D-3 | Pixels MUST stay crisp: set `imageSmoothingEnabled = false` and CSS `image-rendering: pixelated`. |
| D-4 | Text uses a blocky pixel font, either a bitmap font defined in code (preferred) or a generic `monospace` fallback. No web fonts. |
| D-5 | **Colour overlay emulation (MUST):** the original was a monochrome screen behind coloured cellophane. Draw sprites white on black, except: **red** for everything drawn in the band y = 32–63 (the UFO row) and **green** for everything in the band y = 184–239 (shields and player cannon), plus the reserve-cannon icons at the bottom left. |

---

## 3. Timing & Loop

| ID  | Requirement |
|-----|-------------|
| L-1 | Simulation runs at a **fixed 60 updates/second** regardless of display refresh rate. Use `requestAnimationFrame` with a time accumulator. The game MUST play at the same speed on 60 Hz and 144 Hz monitors. |
| L-2 | Clamp the accumulated time (for example to 250 ms max) so a switched-away tab doesn't trigger a burst of catch-up updates. |
| L-3 | Auto-pause on `blur` / `visibilitychange` (hidden). |
| L-4 | Keep update (simulation) separate from render. Rendering MUST NOT change game state. |

---

## 4. Controls

| Action | Keys |
|--------|------|
| Move cannon left / right | ← / → (also A / D) |
| Fire | Space (also Z, ↑) |
| Start game / confirm | Enter |
| Pause / resume | P or Esc |

- Track key state with `keydown`/`keyup`, and tell apart **pressed this frame** from **held**. Don't rely on OS key repeat.
- `preventDefault()` on game keys so the page never scrolls.
- **Fire is edge-triggered**: one press fires one shot, and holding the key does not autofire (this matches the original).

---

## 5. Game Flow & States

Implement an explicit state machine:

`TITLE → WAVE_INTRO → PLAYING ⇄ PAUSED`
`PLAYING → PLAYER_DYING → PLAYING | GAME_OVER`
`PLAYING → WAVE_CLEARED → WAVE_INTRO (next wave)`
`GAME_OVER → TITLE`

| ID  | Requirement |
|-----|-------------|
| F-1 | **Title / attract screen** MUST show the title "SPACE INVADERS", "PRESS ENTER TO START", a controls summary, the high score, and the **"SCORE ADVANCE TABLE"** (UFO = ? MYSTERY, squid = 30, crab = 20, octopus = 10) with the invader sprites. |
| F-2 | **Wave intro:** show "WAVE n" (or "PLAY PLAYER<1>" with the score blinking, as the original does) for about 1.5 s, then start the wave. |
| F-3 | **Paused:** freeze everything and show a "PAUSED" overlay. |
| F-4 | **Game over:** show "GAME OVER" (the original types it out character by character, which SHOULD be copied) and the final score, then return to the title after about 5 s or on Enter. |
| F-5 | Restarting MUST fully reset all state without reloading the page. |
| F-6 | High score is saved in `localStorage` under the key `space-invaders-hiscore`, inside `try/catch` so the game still works when storage is unavailable. |

---

## 6. Playfield Layout (logical pixels)

| Element | Specification |
|---------|---------------|
| HUD top | y = 8–24: `SCORE<1>`, `HI-SCORE`, `SCORE<2>` labels with 4-digit zero-padded scores beneath (`SCORE<2>` always shows `0000`). |
| UFO lane | y ≈ 40 |
| Invader formation (wave 1) | Top row at y ≈ 64. 5 rows × 11 columns, 16 px horizontal pitch, 16 px vertical pitch. Formation starts horizontally centred-left (left column x ≈ 24). |
| Shields | 4 shields, each **22 × 16 px**, top edge at y ≈ 192, evenly spaced across the width. Classic shape: a flat-topped arch with a notch cut out of the bottom centre. |
| Player cannon | 13 × 8 px, top edge at y ≈ 216. |
| Ground line | 1 px green line across the full width at y = 240. |
| HUD bottom | y ≈ 241–256: number of reserve lives followed by reserve cannon icons (left), `CREDIT 00` (right). |

---

## 7. Entities & Mechanics

### 7.1 Invaders

| Type | Rows (top→bottom) | Size | Points |
|------|-------------------|------|--------|
| Squid (small) | Row 1 | 8 × 8 | 30 |
| Crab (medium) | Rows 2–3 | 11 × 8 | 20 |
| Octopus (large) | Rows 4–5 | 12 × 8 | 10 |

Each type has **two animation frames** and switches frame every time it steps.

**Movement (MUST: this is the signature mechanic):**
- The formation marches horizontally in steps of **2 px**.
- Faithful behaviour: the game moves **one invader per frame**, cycling through the living invaders from bottom-left to top-right. A full formation step therefore takes as many frames as there are living invaders (55 alive ≈ one step every 55 frames; 1 alive = one step every frame). This naturally produces the famous **acceleration as invaders are destroyed**, plus a visible "ripple" as the formation moves.
  - Implementing it literally (one invader per frame) is **SHOULD**. At minimum, the step interval MUST scale with the live count as described.
- When any living invader reaches the side margin (≈ 8 px from the edge), the whole formation **drops 8 px** and reverses direction.
- **Last invader:** when only one remains, it steps **3 px when moving right** and 2 px when moving left.
- An invader overlapping a shield **erases the shield pixels** it covers.
- If any invader reaches the player's row (bottom of invader ≥ cannon top, y ≈ 216) → **immediate game over**, regardless of lives left.

**Invader death:** show an explosion sprite for about 16 frames. While it's showing, the formation pauses its march.

### 7.2 Player Cannon
- Moves horizontally at **1 px/frame** and is clamped to the playfield (≈ 8 px margins).
- **Only one player shot can be on screen at a time.** Firing again is ignored until the current shot hits something or leaves the screen.
- Player shot: 1 × 4 px, travels up at **4 px/frame**.
- When a shot hits the top of the playfield (y ≈ 32) it shows a small explosion splat.

### 7.3 Invader Shots
- **At most 3 invader shots on screen**, one of each type:
  - **Rolling shot:** always fired from the column **directly above (or nearest to) the player**. This is the aimed shot.
  - **Plunger shot:** fired from columns following a fixed sequence table. **Not fired when only one invader remains.**
  - **Squiggly shot:** fired from columns following a different fixed sequence table.
- Each shot type has its own 3–4 frame animation (rolling = twisting, plunger = "T" shape, squiggly = zig-zag).
- Shots are fired by the **lowest living invader** in the chosen column.
- Shot speed: **4 px every 3 frames** (≈ 1.33 px/frame). When **8 or fewer invaders remain**, 5 px every 3 frames.
- **Reload interval** (minimum frames between invader shots) depends on the **player's current score**:

  | Player score | Reload interval (frames) |
  |--------------|--------------------------|
  | < 200 | 48 |
  | 200 – 999 | 16 |
  | 1000 – 1999 | 11 |
  | 2000 – 2999 | 8 |
  | ≥ 3000 | 7 |

- A player shot and an invader shot that collide SHOULD destroy each other, with a small explosion.
- An invader shot that reaches the ground line explodes there. It SHOULD also chip the ground line.

### 7.4 Shields (Bunkers)
- MUST be **pixel-destructible**: store each shield as a bitmap, e.g. a 22 × 16 boolean grid or an offscreen canvas.
- Player shots hitting a shield from below and invader shots hitting from above each erase a small irregular explosion-shaped area (about 3–6 px across) where they land, and the shot is destroyed.
- Collisions MUST be tested against the **current** pixels, so shots pass through holes that have already been blown.
- Shields are **fully restored at the start of every wave**.

### 7.5 Mystery UFO (Flying Saucer)
- A 16 × 7 px saucer crosses the UFO lane at about **1 px/frame**.
- It appears about every **25 seconds (1536 frames)** of play, only when **8 or more invaders remain** and no UFO is already on screen.
- Direction: if the player's shot count is even, it enters from the right; if odd, from the left.
- **Score value:** keep a counter that advances with every shot the player fires and wraps after 15. Its index selects a value from this table:
  `[100, 50, 50, 100, 150, 100, 100, 50, 300, 100, 100, 100, 50, 150, 100]`
  (This recreates the known trick where the **23rd shot, and every 15th after it, scores 300** when it hits the UFO.)
- When hit, show the awarded value as text in the UFO's place for about 1 s.

### 7.6 Player Death
- When hit by an invader shot, the cannon plays a **2-frame explosion animation for about 1 second** and **all other action freezes** (invaders stop marching and firing).
- Then the remaining invader shots are cleared, one reserve life is used, and a new cannon appears at the **left side** of the playfield after a short delay (about 1 s).
- No reserve lives left → `GAME_OVER`.

### 7.7 Lives
- Start with **3 cannons** (1 in play + 2 in reserve). The bottom HUD shows the total number of lives and icons for the reserve cannons.
- **One bonus life at 1,500 points** (awarded only once per game).

---

## 8. Waves & Difficulty Progression

In the original, the difficulty jump between waves comes from **each new wave starting lower** on the screen. Speed then ramps within a wave as invaders die (§7.1), and fire rate ramps with score (§7.3).

| ID   | Requirement |
|------|-------------|
| P-1  | A wave is cleared when all 55 invaders are destroyed. Pause about 1.5 s, then start the next wave with a fresh formation and restored shields. Score and lives carry over. |
| P-2  | **Starting height by wave (MUST):** the table below is measured from wave 1's starting top-row position (y ≈ 64). |
| P-3  | The original loops this table after wave 9. **For this project do not loop.** From wave 10 onward, keep the wave-9 height and apply the extra escalation in the last row of the table, so every wave is harder than the one before. |

| Wave | Formation start offset (px lower than wave 1) | Extra escalation |
|------|-----------------------------------------------|------------------|
| 1 | 0 | — |
| 2 | 16 | — |
| 3 | 24 | — |
| 4 | 32 | — |
| 5 | 32 | reload intervals −1 frame |
| 6 | 32 | reload intervals −1 frame |
| 7 | 40 | reload intervals −2 frames |
| 8 | 40 | reload intervals −2 frames |
| 9 | 40 | reload intervals −2 frames |
| 10+ | 40 | reload intervals −(wave − 7) frames, **minimum 4 frames**; invader shot speed +0.1 px/frame per wave beyond 9, **max 2.0 px/frame** |

- Put the difficulty table in a single data structure (for example `WAVE_TABLE`), not in scattered conditionals.
- Show the current wave number somewhere unobtrusive (for example beside `CREDIT`, or during the wave intro).

---

## 9. Silent-Game Visual Cues

The original relied on sound for some feedback. Show these visually instead:

| Original audio cue | Required visual replacement |
|--------------------|-----------------------------|
| 4-note marching "heartbeat" that speeds up | SHOULD: a subtle 4-step pulse in the ground line (or a small indicator) synced to formation steps. Their pace makes the acceleration readable. |
| UFO warble | The UFO itself is enough. MAY flicker slightly. |
| Extra-life chime | Flash the new reserve icon for about 1 s. |
| Player explosion | The explosion animation plus a brief screen shake (≤ 2 px) is OPTIONAL. |

---

## 10. Scoring Summary

| Event | Points |
|-------|--------|
| Octopus (bottom 2 rows) | 10 |
| Crab (middle 2 rows) | 20 |
| Squid (top row) | 30 |
| Mystery UFO | 50 / 100 / 150 / 300 (see §7.5) |
| Extra life | at 1,500 |

Scores show as 4 digits, zero-padded (they MAY roll past 9999 to 5 digits).

---

## 11. Evaluation Hooks

| ID  | Requirement |
|-----|-------------|
| E-1 | MUST: when the page URL contains the hash `#level=N` (N ≥ 1), starting from the title screen begins at **wave N** with its full difficulty settings, 3 lives and score 0. Evaluators use this to check difficulty progression. |
| E-2 | SHOULD: expose `window.game.getState()` returning `{ state, level, score, lives, highScore }`, a plain snapshot object. |
| E-3 | SHOULD: the hash `#debug` shows an overlay with FPS, live invader count, current step interval, reload interval and hitboxes. |

---

## 12. Code Quality Requirements

| ID   | Requirement |
|------|-------------|
| Q-1  | One `<script>` block, `'use strict'` (or `type="module"`). |
| Q-2  | Code is organised into clearly marked sections with header comments, for example: Config → Utilities → Input → Sprites/Assets → Entities → Wave/Difficulty data → State machine → Update → Render → Bootstrap. |
| Q-3  | All tunable values (speeds, sizes, scores, timings, difficulty tables) live in named constants or a config object near the top. No unexplained magic numbers in the logic. |
| Q-4  | No global-namespace pollution beyond one namespace object (plus the `window.game` hook). |
| Q-5  | Descriptive names, small single-purpose functions, and comments that explain *why*, especially where you reproduce a quirk of the original. |
| Q-6  | No dead code, commented-out code or leftover `console.log`. |
| Q-7  | Avoid per-frame allocations in hot paths where practical (reuse shot and explosion objects). No memory growth over a 30-minute session. |
| Q-8  | Consistent formatting and indentation throughout. |
| Q-9  | Collision detection MUST be robust: a shot MUST NOT pass through an invader, shield or UFO between frames. |

---

## 13. Out of Scope

Audio of any kind, 2-player alternating play, coin/credit logic (credits are cosmetic), cocktail-mode screen flip, online leaderboards. Touch and gamepad controls MAY be added but are not scored.

---

## 14. Acceptance Criteria (evaluator checklist)

1. [ ] The file opens offline from `file://` with no console errors. There are no network requests and no audio.
2. [ ] The title screen shows the score advance table, high score and controls. Enter starts the game.
3. [ ] 55 invaders in 5 × 11 formation (1 row squid, 2 crab, 2 octopus), each with two animation frames.
4. [ ] The formation marches, drops 8 px at edges, and **clearly speeds up as invaders are destroyed**. The last invader is very fast.
5. [ ] Only one player shot on screen at a time. Holding fire doesn't autofire.
6. [ ] At most 3 invader shots in 3 distinct styles. One type aims at the player's column.
7. [ ] Four shields erode pixel by pixel from shots above and below, and from invaders passing through them.
8. [ ] The mystery UFO appears periodically and awards 50/100/150/300 using the shot-count table.
9. [ ] Scoring is correct at 10/20/30. The high score persists across reloads.
10. [ ] The player starts with 3 lives, gets a bonus life at 1,500, and play freezes during the death explosion.
11. [ ] Invaders reaching the cannon's row ends the game immediately.
12. [ ] Each new wave starts lower, following §8. `#level=10` is noticeably harder than wave 1.
13. [ ] Pause works, and play auto-pauses on tab switch. Speed is identical on 60 Hz and high-refresh displays.
14. [ ] The red/green overlay bands are rendered.
15. [ ] Game over returns to the title. Restart works without reloading the page.
