# PRD: Galaxian Clone (Single-File HTML5)

**Reference game:** *Galaxian*, Namco, 1979 (arcade, upright cabinet)
**Deliverable:** one self-contained HTML file. The operator will give you the filename. Use exactly that name.

---

## 0. How to Read This Document

- **MUST** means required. **SHOULD** means strongly expected, and leaving it out lowers the score. **MAY** means optional polish.
- Gameplay should be **faithful to the original arcade game**. Where this document gives a value, use it. Where it says nothing, copy the original's behaviour as closely as you can.
- If this document conflicts with what you remember of the original, **this document wins**.
- All speeds and timings assume **60 simulation frames per second**, with distances in **logical pixels**.
- Note: this is **Galaxian**, not *Galaga*. There are **no** tractor beams, captured or dual fighters, challenge stages or "fly-in" entry formations.

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
| D-1 | Fixed logical resolution **224 × 256** (portrait). All game logic uses logical pixels. |
| D-2 | Scale the canvas to the largest integer multiple that fits the browser window (fall back to fractional scaling if the window is smaller than 1×). Centre it on a black page with no scrollbars. Re-fit when the window resizes. |
| D-3 | Pixels MUST stay crisp: set `imageSmoothingEnabled = false` and CSS `image-rendering: pixelated`. |
| D-4 | Text uses a blocky pixel font, either a bitmap font defined in code (preferred) or a generic `monospace` fallback. No web fonts. |
| D-5 | Full colour, in the original's palette: flagships yellow with red; escorts red; emissaries purple/magenta; drones blue/cyan; player ship white, red and blue; HUD text red/white. |

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
| Move ship left / right | ← / → (also A / D) |
| Fire | Space (also Z, ↑) |
| Start game / confirm | Enter |
| Pause / resume | P or Esc |

- Track key state with `keydown`/`keyup`, and tell apart **pressed this frame** from **held**. Don't rely on OS key repeat.
- `preventDefault()` on game keys so the page never scrolls.
- **Fire is edge-triggered**: one press fires one missile, and holding the key doesn't autofire.

---

## 5. Game Flow & States

`TITLE → LEVEL_INTRO → PLAYING ⇄ PAUSED`
`PLAYING → PLAYER_DYING → RESPAWN → PLAYING | GAME_OVER`
`PLAYING → LEVEL_CLEARED → LEVEL_INTRO (next level)`
`GAME_OVER → TITLE`

| ID  | Requirement |
|-----|-------------|
| F-1 | **Title / attract screen** MUST show the title "GALAXIAN", "PRESS ENTER TO START", a controls summary, the high score, and the **"WE ARE THE GALAXIANS / MISSION: DESTROY ALIENS"** score table showing each alien sprite with its CONVOY and CHARGER values (see §10). The starfield scrolls behind it. |
| F-2 | **Level intro:** show "PLAYER 1" / "READY" (or "LEVEL n") for about 2 s over the starfield while the formation appears in place, then play begins. |
| F-3 | **Paused:** freeze everything (starfield included) and show a "PAUSED" overlay. |
| F-4 | **Game over:** show "GAME OVER" and the final score, then return to the title after about 5 s or on Enter. |
| F-5 | Restarting MUST fully reset all state without reloading the page. |
| F-6 | High score is saved in `localStorage` under the key `galaxian-hiscore`, inside `try/catch`. |

---

## 6. Playfield Layout (logical pixels)

| Element | Specification |
|---------|---------------|
| HUD top | y = 0–20: `1UP` (blinking) with the score below it at left, and `HIGH SCORE` centred with its value below. |
| Formation ("convoy") | Top row at y ≈ 40. Horizontal pitch 16 px, vertical pitch 12 px, using a **10-column** grid. |
| Player ship ("Galaxip") | ≈ 15 × 16 px, top edge at y ≈ 220. |
| HUD bottom | y ≈ 244–256: reserve ship icons (left), **level flags** (right). |
| Starfield | Behind everything (§7.6). |

### 6.1 Formation Composition (MUST: 46 aliens)

| Row (top→bottom) | Alien | Count | Grid columns (0-9) |
|------------------|-------|-------|--------------------|
| 1 | Flagship (yellow "Galaxian boss") | 2 | 3, 6 |
| 2 | Escort (red) | 6 | 2–7 |
| 3 | Emissary (purple) | 8 | 1–8 |
| 4 | Drone (blue) | 10 | 0–9 |
| 5 | Drone (blue) | 10 | 0–9 |
| 6 | Drone (blue) | 10 | 0–9 |

- The whole convoy **sways left and right** as a unit at about 0.25–0.5 px/frame, reversing at the playfield edges. It **never descends**. This is the key difference from *Space Invaders*.
- Aliens in the convoy play a **2–3 frame wing-flap animation**, staggered so the formation "shimmers".

---

## 7. Entities & Mechanics

### 7.1 Player Ship
- Moves horizontally only, at about **1.5 px/frame**, clamped to the playfield.
- **Only one missile at a time.** When loaded, the missile is **drawn sitting on the ship's nose**. On fire it launches upward at about **5 px/frame**, and the nose stays empty until the missile hits or leaves the top of the screen, then it immediately reloads.
- The ship is destroyed if it touches an enemy bomb **or a diving alien**. Colliding with a diving alien also destroys that alien, which scores as a hit.

### 7.2 Diving Attacks ("Chargers")
This is the core of the game and MUST be convincing.

- Periodically (see the §8 table), an alien **peels off from the convoy**, usually one at an **exposed edge** of the formation (leftmost or rightmost of its row). Aliens on the left side of the convoy peel left, and those on the right peel right.
- **Dive path:** the alien rises slightly and **loops outward in a half-circle**, rotating its sprite to face its direction of travel (at least 8 rotation angles, preferably 16). It then swoops down toward the player in a curving path that **steers horizontally toward the player's current x**, with a limited turn rate so it can be dodged.
- While diving, it drops **bombs** (small vertical dashes) toward the player at about 2 px/frame. The number per dive depends on level (see §8).
- An alien that passes the bottom of the screen **wraps around to re-enter from the top** and flies back down to rejoin its empty slot in the swaying convoy, which it must track. At higher levels it may instead dive again straight away (see §8).
- **Flagship attacks:** a flagship dives accompanied by **up to 2 red escorts** taken from the positions directly beneath it (escorts that have already been destroyed are skipped). The escorts fly in tight formation beside and behind the flagship through the whole dive.
- Red escorts and purple emissaries SHOULD also sometimes dive in small groups of 2–3.
- **Blue drones SHOULD dive in a wider, more swooping arc**, and SHOULD be the main attackers early in a level.
- **Endgame rush:** when the convoy has **8 or fewer aliens left**, or only drones remain, the survivors **dive continuously** without returning to formation and keep attacking until they are destroyed. Their dive speed increases slightly.

### 7.3 Player Death & Respawn
- The ship's explosion animation plays for about 1 s. Bombs in flight keep moving until they leave the screen.
- **All divers finish their dives and return to the convoy** before a new ship appears. No new dives start during this time.
- Then, if a reserve ship remains, it appears at bottom centre and play resumes after about 1 s. Otherwise → `GAME_OVER`.

### 7.4 Alien Death
- A hit alien is replaced by a multi-frame explosion (about 4 frames over 20 game frames).
- A **diving flagship** that is destroyed shows its bonus score value as text at the explosion point for about 1 s.

### 7.5 Level Clear
- A level is cleared when all 46 aliens are destroyed. After about 2 s, the next level's full convoy appears. Score and lives carry over, and a **level flag is added** at the bottom right.

### 7.6 Starfield (MUST)
- About 80–150 single-pixel stars in several colours (red, green, blue, yellow, white, cyan and so on), scrolling **downward** slowly (about 0.5 px/frame) and wrapping.
- Stars **twinkle**: split them into 2–4 groups that blink on and off at staggered intervals.
- The starfield keeps moving on the title screen and between lives.

### 7.7 Lives
- Start with **3 ships** (1 in play + 2 in reserve), shown as icons at the bottom left.
- **One bonus ship at 7,000 points.**

### 7.8 Level Flags
- Bottom right: one small red flag per level reached. For clarity, every 10 levels are replaced by one larger flag (this matches later Namco conventions and is acceptable here).

---

## 8. Difficulty Progression

Aggression increases every level. Keep all values in a single data table (for example `LEVEL_TABLE`) so it is easy to review.

| Level | Frames between new dive launches | Max simultaneous divers (incl. escorts) | Bombs per dive | Dive speed multiplier | Bomb speed (px/frame) | Divers re-dive from top instead of rejoining |
|-------|------|------|------|------|------|------|
| 1 | 180 | 2 | 1–2 | 1.00 | 2.0 | No |
| 2 | 150 | 3 | 1–2 | 1.05 | 2.0 | No |
| 3 | 130 | 4 | 1–3 | 1.10 | 2.2 | No |
| 4 | 110 | 5 | 2–3 | 1.15 | 2.3 | 25% chance |
| 5 | 95  | 6 | 2–3 | 1.20 | 2.4 | 50% chance |
| 6+ | max(50, 95 − 7 × (L − 5)) | min(10, 6 + (L − 5)) | 2–4 | min(1.5, 1.20 + 0.05 × (L − 5)) | min(3.0, 2.4 + 0.1 × (L − 5)) | 75% chance |

Additional rules:
- Flagship dives (with escorts) start at level 1. Their chance per dive launch SHOULD rise with level (for example 15% at level 1, up to 40% max).
- The steering turn rate toward the player SHOULD increase slightly each level (aim sharpens).
- Enemy bombs MUST NOT be fired from off-screen (above y = 32) or from below the player.

---

## 9. Silent-Game Visual Cues

| Original audio cue | Required visual replacement |
|--------------------|-----------------------------|
| Background "swarm" drone | none needed |
| Diving "swoop" | The alien's sprite rotation makes the dive visible. MAY add a brief colour flash at peel-off. |
| Flagship hit | Bonus score text at the explosion (MUST, §7.4). |
| Extra ship | Flash the new reserve icon for about 1 s. |
| `1UP` indicator | Blink the `1UP` label during play (as in the original). |

---

## 10. Scoring

| Alien | In convoy | Diving ("charger") |
|-------|-----------|--------------------|
| Drone (blue) | 30 | 60 |
| Emissary (purple) | 40 | 80 |
| Escort (red) | 50 | 100 |
| Flagship (yellow) | 60 | see below |

**Diving flagship bonus:**

| Situation when the flagship is hit | Points |
|------------------------------------|--------|
| Diving alone (launched with no escorts) | 150 |
| 1 escort still alive in the dive | 200 |
| 2 escorts still alive in the dive | 300 |
| Launched with 2 escorts and **both escorts were shot first** during this dive | **800** |
| Launched with 2 escorts, 1 shot first, 1 still alive | 200 |

- Bonus ship at 7,000 points.
- Scores show up to 6 digits.

---

## 11. Evaluation Hooks

| ID  | Requirement |
|-----|-------------|
| E-1 | MUST: when the page URL contains the hash `#level=N` (N ≥ 1), starting from the title screen begins at **level N** with its full difficulty settings, 3 lives and score 0. |
| E-2 | SHOULD: expose `window.game.getState()` returning `{ state, level, score, lives, highScore }`, a plain snapshot object. |
| E-3 | SHOULD: the hash `#debug` shows an overlay with FPS, active diver count, current level parameters and hitboxes. |

---

## 12. Code Quality Requirements

| ID   | Requirement |
|------|-------------|
| Q-1  | One `<script>` block, `'use strict'` (or `type="module"`). |
| Q-2  | Code is organised into clearly marked sections with header comments, for example: Config → Utilities → Input → Sprites/Assets → Starfield → Entities → Dive-path logic → Level/Difficulty data → State machine → Update → Render → Bootstrap. |
| Q-3  | All tunable values (speeds, scores, timings, difficulty tables) live in named constants or a config object near the top. No unexplained magic numbers in the logic. |
| Q-4  | No global-namespace pollution beyond one namespace object (plus the `window.game` hook). |
| Q-5  | Dive paths MUST be implemented as clear, reusable logic, such as a steering behaviour or a parametric/Bézier path plus homing, and not as copy-pasted per-alien code. |
| Q-6  | Descriptive names, small single-purpose functions, and comments that explain *why*. |
| Q-7  | No dead code, commented-out code or leftover `console.log`. |
| Q-8  | Avoid per-frame allocations in hot paths where practical (pool bombs, explosions, stars). No memory growth over a 30-minute session. |
| Q-9  | Collision detection MUST be robust: a missile MUST NOT pass through an alien between frames. |
| Q-10 | Consistent formatting and indentation throughout. |

---

## 13. Out of Scope

Audio of any kind, 2-player alternating play, coin/credit logic, cocktail-mode flip, online leaderboards, and any *Galaga* features. Touch and gamepad controls MAY be added but are not scored.

---

## 14. Acceptance Criteria (evaluator checklist)

1. [ ] The file opens offline from `file://` with no console errors. There are no network requests and no audio.
2. [ ] The title screen shows the score table, high score and controls over a scrolling, twinkling multicolour starfield.
3. [ ] 46 aliens in the correct 2/6/8/10/10/10 convoy with correct colours, a wing-flap animation, and side-to-side sway without descending.
4. [ ] The player has one missile at a time, visibly resting on the ship's nose when ready.
5. [ ] Aliens peel off from the formation edges, loop, rotate to face their direction of travel, home in on the player and drop bombs.
6. [ ] Divers that leave the bottom re-enter from the top and rejoin their slot in the moving convoy.
7. [ ] Flagships dive with up to 2 red escorts, and the flagship bonus scoring (150/200/300/800) is correct.
8. [ ] Convoy vs. diving scores differ correctly for every alien type.
9. [ ] The endgame rush happens: the last few aliens attack continuously.
10. [ ] Colliding with a diver kills the player. During respawn, divers return to the convoy first.
11. [ ] The player starts with 3 lives, gets a bonus at 7,000, and level flags accumulate at the bottom right.
12. [ ] Difficulty clearly increases per level. `#level=8` is noticeably more aggressive than level 1.
13. [ ] Pause works, and play auto-pauses on tab switch. Speed is identical on 60 Hz and high-refresh displays.
14. [ ] The high score persists across reloads. Game over returns to the title, and restart works without reloading the page.
