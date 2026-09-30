# PRD: Breakout Clone (Single-File HTML5)

**Reference game:** *Breakout*, Atari, 1976 (arcade, upright cabinet, B&W monitor with coloured overlay strips)
**Deliverable:** one self-contained HTML file. The operator will give you the filename. Use exactly that name.

---

## 0. How to Read This Document

- **MUST** means required. **SHOULD** means strongly expected, and leaving it out lowers the score. **MAY** means optional polish.
- Gameplay should be **faithful to the original 1976 arcade game**. Where this document gives a value, use it. Where it says nothing, copy the original's behaviour as closely as you can.
- If this document conflicts with what you remember of the original, **this document wins**.
- All speeds and timings assume **60 simulation frames per second**, with distances in **logical pixels**.
- Note: this is **Breakout**, not *Arkanoid*. There are **no** power-ups, capsules, enemies, lasers, multi-ball or indestructible bricks.

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
| D-1 | Fixed logical resolution **240 × 320** (portrait). All game logic uses logical pixels. |
| D-2 | Scale the canvas to the largest integer multiple that fits the browser window (fall back to fractional scaling if the window is smaller than 1×). Centre it on a black page with no scrollbars. Re-fit when the window resizes. |
| D-3 | Pixels MUST stay crisp: set `imageSmoothingEnabled = false` and CSS `image-rendering: pixelated`. |
| D-4 | Text uses a blocky pixel font, either a bitmap font defined in code (preferred) or a generic `monospace` fallback. No web fonts. The original's large blocky score digits SHOULD be copied. |
| D-5 | **Overlay emulation:** the original was a white-on-black monitor with coloured cellophane strips. Use a black background, grey/white walls, a white ball, a **blue**-tinted paddle, and brick rows coloured by band (§6.1). |

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

The original used a **rotary paddle controller**, so smooth analog control matters.

| Action | Input |
|--------|-------|
| Move paddle | **Mouse**: paddle x follows the pointer's horizontal position over the canvas, mapped to logical coordinates (MUST). Keyboard: ← / → (also A / D) (MUST). |
| Serve ball | Space, or left mouse click |
| Start game / confirm | Enter (or click on the title screen) |
| Pause / resume | P or Esc |

- Keyboard paddle speed: **4 px/frame** while held. It SHOULD include a short 3–4 frame acceleration ramp for fine control.
- Mouse control MUST be 1:1 with no lag or smoothing. Pointer lock MAY be offered on click, but it is not required.
- Track key state with `keydown`/`keyup`. `preventDefault()` on game keys so the page never scrolls.

---

## 5. Game Flow & States

`TITLE → LEVEL_INTRO → SERVE_WAIT → PLAYING ⇄ PAUSED`
`PLAYING → BALL_LOST → SERVE_WAIT | GAME_OVER`
`PLAYING → LEVEL_CLEARED → LEVEL_INTRO (next level)`
`GAME_OVER → TITLE`

| ID  | Requirement |
|-----|-------------|
| F-1 | **Title / attract screen** MUST show the title "BREAKOUT", "PRESS ENTER TO START", a controls summary and the high score. SHOULD run an **attract-mode demo** behind it (the ball bouncing around a full wall on its own, with the paddle auto-tracking it). |
| F-2 | **Level intro:** show "LEVEL n" for about 1.5 s over the fresh wall. |
| F-3 | **Serve wait:** the ball is not in play. Show "PRESS SPACE / CLICK TO SERVE". The paddle can still move. |
| F-4 | **Paused:** freeze everything and show a "PAUSED" overlay. |
| F-5 | **Ball lost:** the ball leaves the bottom. Show a short pause (about 1 s), then use up one ball. With balls remaining → `SERVE_WAIT`, otherwise → `GAME_OVER`. |
| F-6 | **Game over:** show "GAME OVER" and the final score, then return to the title after about 5 s or on Enter. |
| F-7 | Restarting MUST fully reset all state without reloading the page. |
| F-8 | High score is saved in `localStorage` under the key `breakout-hiscore`, inside `try/catch`. |

---

## 6. Playfield Layout (logical pixels)

| Element | Specification |
|---------|---------------|
| HUD | y = 0–31: score (left), `BALL n` (the current ball number, counting up as in the original, centre), `LEVEL n` and `HI nnn` (right). |
| Top wall | y = 32–39 (8 px thick), full width. |
| Side walls | x = 0–7 and x = 232–239 (8 px thick), from the top wall down to the bottom of the screen. |
| Play area interior | x = 8–231 (224 px wide). |
| Brick wall (level 1) | Top brick row at y = 64. 8 rows × 14 columns. Each brick cell is **16 × 8**, drawn as **15 × 6** with gaps. There is an empty gap between the top wall and the first row (the "breakthrough" space). |
| Paddle | Top edge at y = 296, **height 4**, **width 24** (normal) / **12** (shrunk, §7.4). |
| Ball | **4 × 4 square** (the original ball is square, MUST). |

### 6.1 Brick Rows (MUST)

| Rows (top → bottom) | Colour | Points each |
|---------------------|--------|-------------|
| 1–2 | Red | 7 |
| 3–4 | Orange | 5 |
| 5–6 | Green | 3 |
| 7–8 | Yellow | 1 |

112 bricks per wall. A full wall is worth **448 points**.

---

## 7. Mechanics

### 7.1 Serve
- On serve, the ball appears at a random x within the middle 60% of the play area, just below the lowest brick row (y ≈ 140). It moves **downward toward the paddle** at a random angle of 30°–45° from vertical, in a random left or right direction, at the current base speed (§7.3).

### 7.2 Paddle Bounce (MUST: this is the skill element)
- The bounce angle depends **only on where the ball hits the paddle**, not on the incoming angle. Split the paddle into **8 equal segments**:

  | Segment (from centre outward) | Outgoing angle from vertical |
  |-------------------------------|------------------------------|
  | Inner 2 (centre) | 15° |
  | Next 2 | 30° |
  | Next 2 | 45° |
  | Outer 2 (edges) | 60° |

  The horizontal direction follows the side of the paddle that was hit (left half → up-left, right half → up-right).
- The ball MUST NEVER travel perfectly horizontally or perfectly vertically.
- Only register a paddle bounce when the ball is moving **downward**, so it never gets stuck inside the paddle.

### 7.3 Ball Speed Tiers (MUST)
The ball has 5 speed tiers. **Each of these four events raises the tier by one, and each can happen only once per ball served:**
1. The **4th** hit (paddle contact) since the serve
2. The **12th** hit since the serve
3. The **first contact with an orange brick**
4. The **first contact with a red brick**

| Tier | Base speed (px/frame) |
|------|-----------------------|
| 0 (serve) | 1.6 |
| 1 | 2.0 |
| 2 | 2.4 |
| 3 | 2.8 |
| 4 | 3.2 |

The actual speed is `tierSpeed × levelSpeedMultiplier` (§8). The tier **resets to 0** on each new serve. The speed is the **length** of the velocity vector, so it stays constant whatever the angle.

### 7.4 Brick Collisions & Breakthrough
- When the ball hits a brick, the brick is destroyed, its points are added, and the ball **reflects**: vertical velocity inverts on a top or bottom face hit, horizontal velocity inverts on a side face hit. Decide which face was hit correctly from the ball's previous position and velocity.
- **At most one brick is destroyed per frame/step**, which prevents the ball from ploughing through a column in a single frame.
- **Breakthrough:** once the player carves a channel through the wall, the ball can reach the space above the bricks and bounce between the top wall and the top of the brick wall, destroying bricks from above. This MUST work correctly because it is the game's defining moment.
- **Paddle shrink (MUST):** the first time the ball **hits the top wall** in a level (which normally means it broke through the red rows), the paddle shrinks to **half width** (24 → 12 px) around its centre. It stays half width for the rest of that level, and a new level restores full width.

### 7.5 Walls
- The ball reflects off the side walls and the top wall.
- The bottom is open. When the ball's top edge passes the bottom of the screen, the ball is lost.

### 7.6 Collision Robustness (MUST)
- The ball MUST NOT tunnel through bricks, walls or the paddle at any speed. Use sub-stepping (for example, split each frame's movement into steps of ≤ 2 px) or swept collision.
- The ball MUST NOT get stuck oscillating inside a wall, a brick or the paddle.

### 7.7 Lives (Balls)
- **3 balls per game.** The HUD shows the current ball number (1, 2, 3), as in the original.
- No extra balls are awarded.

---

## 8. Levels & Difficulty Progression

The original gave 2 walls and then ended the game (maximum 896 points). **This clone continues indefinitely**, getting harder with each level.

| ID  | Requirement |
|-----|-------------|
| P-1 | When every brick in the wall is destroyed, the level is cleared. The ball is removed, and after about 1.5 s the next level's wall appears in `SERVE_WAIT`. The ball count does **not** reset. The score carries over. |
| P-2 | Levels 1–2 play exactly like the original (multiplier 1.0, standard layout). |
| P-3 | From level 3 onward, apply the table below. Keep it in one data structure (for example `LEVEL_TABLE`). |

| Level | Speed multiplier | Paddle width (normal / shrunk) | Wall top-row y (moves closer to the paddle) |
|-------|------------------|--------------------------------|---------------------------------------------|
| 1 | 1.00 | 24 / 12 | 64 |
| 2 | 1.00 | 24 / 12 | 64 |
| 3 | 1.10 | 24 / 12 | 72 |
| 4 | 1.15 | 22 / 11 | 72 |
| 5 | 1.20 | 22 / 11 | 80 |
| 6 | 1.25 | 20 / 10 | 80 |
| 7 | 1.30 | 20 / 10 | 88 |
| 8+ | min(1.60, 1.30 + 0.05 × (L − 7)) | 18 / 9 | 96 (max) |

- Brick colours and point values stay the same on every level.
- Sub-stepping (§7.6) MUST keep collision correct at the highest speeds (3.2 × 1.6 ≈ 5.1 px/frame).

---

## 9. Silent-Game Visual Cues

| Original audio cue | Required visual replacement |
|--------------------|-----------------------------|
| Paddle "blip" | The paddle flashes white for 2–3 frames on contact. |
| Brick "bloop" (pitch by row) | The brick flashes or pops for 2–4 frames before disappearing (MAY add a tiny particle burst in the brick's colour). |
| Wall bounce tone | none needed |
| Speed-tier increase | SHOULD: a brief visual marker, such as a short ball trail that appears at higher tiers or a small flash of the side walls. |
| Paddle shrink | The paddle visibly animates to half width over about 6 frames, with a short flash. |

---

## 10. Scoring Summary

| Event | Points |
|-------|--------|
| Yellow brick | 1 |
| Green brick | 3 |
| Orange brick | 5 |
| Red brick | 7 |
| Full wall | 448 |

Scores show in the large blocky digit style, at least 3 digits and more as needed.

---

## 11. Evaluation Hooks

| ID  | Requirement |
|-----|-------------|
| E-1 | MUST: when the page URL contains the hash `#level=N` (N ≥ 1), starting from the title screen begins at **level N** with its full difficulty settings, 3 balls and score 0. |
| E-2 | SHOULD: expose `window.game.getState()` returning `{ state, level, score, lives, highScore }` (`lives` = balls remaining), a plain snapshot object. |
| E-3 | SHOULD: the hash `#debug` shows an overlay with FPS, speed tier, current speed, hit count, paddle width and hitboxes. |

---

## 12. Code Quality Requirements

| ID   | Requirement |
|------|-------------|
| Q-1  | One `<script>` block, `'use strict'` (or `type="module"`). |
| Q-2  | Code is organised into clearly marked sections with header comments, for example: Config → Utilities → Input → Entities (Ball, Paddle, Wall) → Collision → Level/Difficulty data → State machine → Update → Render → Bootstrap. |
| Q-3  | All tunable values (speeds, tiers, sizes, scores, angles, difficulty tables) live in named constants or a config object near the top. No unexplained magic numbers in the logic. |
| Q-4  | No global-namespace pollution beyond one namespace object (plus the `window.game` hook). |
| Q-5  | Collision code is clear and isolated (for example `collideBallWithRect()`), with comments explaining how the hit face is decided. |
| Q-6  | Descriptive names, small single-purpose functions, and comments that explain *why*. |
| Q-7  | No dead code, commented-out code or leftover `console.log`. |
| Q-8  | No per-frame allocations in hot paths where practical. No memory growth over a 30-minute session. |
| Q-9  | Consistent formatting and indentation throughout. |

---

## 13. Out of Scope

Audio, 2-player alternating play, power-ups or any *Arkanoid*-style features, coin/credit logic, online leaderboards. Touch and gamepad controls MAY be added but are not scored.

---

## 14. Acceptance Criteria (evaluator checklist)

1. [ ] The file opens offline from `file://` with no console errors. There are no network requests and no audio.
2. [ ] The title screen shows the high score and controls, and ideally an attract demo.
3. [ ] 8 rows × 14 bricks, coloured red/orange/green/yellow in pairs of rows, scoring 7/5/3/1.
4. [ ] The ball is a square. The paddle is controllable by both mouse (1:1) and keyboard.
5. [ ] The bounce angle depends on where the ball hits the paddle. The ball never travels purely horizontally or vertically.
6. [ ] The ball speeds up after 4 hits, after 12 hits, and on first orange and first red contact. It resets on serve.
7. [ ] Breaking through lets the ball bounce above the wall, destroying bricks from the top.
8. [ ] The paddle shrinks to half width on the first top-wall hit and restores on the next level.
9. [ ] No tunnelling or stuck ball at any speed, including at `#level=10`.
10. [ ] 3 balls per game, with the ball number shown. Game over returns to the title.
11. [ ] The game continues past wall 2, with each level faster, the paddle smaller and the wall lower, as in §8.
12. [ ] Pause works, and play auto-pauses on tab switch. Speed is identical on 60 Hz and high-refresh displays.
13. [ ] The high score persists across reloads. Restart works without reloading the page.
