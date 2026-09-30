# PRD: Super Mario Bros. Clone (Single-File HTML5)

**Reference game:** *Super Mario Bros.*, Nintendo, 1985 (NES / Famicom)
**Deliverable:** one self-contained HTML file. The operator will give you the filename. Use exactly that name.

---

## 0. How to Read This Document

- **MUST** means required. **SHOULD** means strongly expected, and leaving it out lowers the score. **MAY** means optional polish.
- Gameplay, and **especially movement physics**, should be **faithful to the original NES game**. Where this document gives a value, use it. Where it says nothing, copy the original's behaviour as closely as you can.
- If this document conflicts with what you remember of the original, **this document wins**.
- All speeds and timings assume **60 simulation frames per second**, with distances in **logical pixels**. Velocities are px/frame and accelerations are px/frame².
- **Scope:** this is a *World 1* recreation (stages 1-1 to 1-4) that loops with rising difficulty (§8). It is not the full 32-stage game.

---

## 1. Deliverable & Hard Constraints

| ID  | Requirement |
|-----|-------------|
| C-1 | MUST be exactly **one self-contained `.html` file**, named exactly as the operator specifies. All HTML, CSS and JavaScript are inline. |
| C-2 | MUST NOT load any external resource: no CDNs, libraries, web fonts, image/JSON files or network requests of any kind. It must run fully offline when opened via `file://`. |
| C-3 | MUST be **completely silent**: no `<audio>`/`<video>` elements, no Web Audio API, no speech synthesis. Where the original used a sound or music to convey information, use a visual cue instead (see §10). |
| C-4 | MUST use plain JavaScript (ES2020+) and the HTML5 Canvas 2D API. No frameworks, transpilers or build steps. |
| C-5 | All graphics MUST be produced by the code, preferably as 16 × 16 pixel-art tiles and sprites defined in inline arrays/strings with a palette, pre-rendered to offscreen canvases at startup. Do **not** embed ripped ROM graphics. Draw recreations. |
| C-6 | MUST run in current desktop Chrome, Firefox, Safari and Edge with **no console errors or warnings**. |
| C-7 | Output MUST be complete: no placeholders, `TODO`s, stubs or "…rest of code here". Levels MUST be fully authored, not procedurally random. A file that does not run counts as a failure. |

---

## 2. Display

| ID  | Requirement |
|-----|-------------|
| D-1 | Fixed logical resolution **256 × 240** (NES). All game logic uses logical pixels. The **tile size is 16 × 16**, so the visible area is 16 tiles wide and 15 tall. The top 2 tile rows are HUD, and the playfield is 13 rows with the ground in the bottom 2. |
| D-2 | Scale the canvas to the largest integer multiple that fits the browser window (fall back to fractional scaling if the window is smaller than 1×). Centre it on a black page with no scrollbars. Re-fit when the window resizes. |
| D-3 | Pixels MUST stay crisp: set `imageSmoothingEnabled = false` and CSS `image-rendering: pixelated`. Draw at integer camera offsets so there's no sub-pixel shimmer. |
| D-4 | Text uses a blocky 8 × 8 pixel font, preferably a bitmap font defined in code, or a generic `monospace` fallback. No web fonts. |
| D-5 | Palette: overworld sky **#5C94FC**, underground/castle background **#000000**. Use NES-like colours for bricks, ground, pipes (green), ? blocks (orange/yellow and flashing), and Mario (red/brown/skin). |

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

| NES button | Keys |
|------------|------|
| D-pad left / right | ← / → (also A / D) |
| D-pad down (crouch when big, enter pipe) | ↓ (also S) |
| **A: Jump** | Z, Space, or K |
| **B: Run / Fireball** | X, Shift, or J |
| Start (start / pause) | Enter |
| Pause (alternative) | P or Esc |

- Track key state with `keydown`/`keyup`, and tell apart **pressed this frame** from **held**. Don't rely on OS key repeat.
- `preventDefault()` on game keys so the page never scrolls.
- Jump starts only on a fresh press of A while on the ground. Holding A must not bunny-hop.
- **Fireballs** fire on a fresh press of B, and holding B is also the run button, exactly as on the NES.

---

## 5. Game Flow & States

`TITLE → LEVEL_CARD → PLAYING ⇄ PAUSED`
`PLAYING → DYING → LEVEL_CARD (retry) | GAME_OVER`
`PLAYING → FLAGPOLE / AXE → LEVEL_COMPLETE (tally) → LEVEL_CARD (next)`
`GAME_OVER → TITLE`

| ID  | Requirement |
|-----|-------------|
| F-1 | **Title screen** MUST show a "SUPER MARIO BROS."-style title banner, "PRESS ENTER TO START", a controls summary and "TOP- nnnnnn" (the high score), drawn over the start of 1-1 like the original. |
| F-2 | **Level card:** a black screen showing `WORLD w-s` and a Mario icon with `× lives` for about 2.5 s before every attempt at a stage. |
| F-3 | **Paused:** freeze everything and show "PAUSED". |
| F-4 | **Dying:** freeze the world for about 0.5 s, then Mario (in the "death" pose) hops up and falls off the bottom of the screen, taking about 2.5 s in total. Lose a life. With lives left → the level card for the **same stage** (with a mid-stage checkpoint, §7.10). With none → `GAME_OVER`. |
| F-5 | **Game over:** show "GAME OVER" on black for about 4 s, then return to the title. |
| F-6 | Restarting MUST fully reset all state without reloading the page. |
| F-7 | High score is saved in `localStorage` under the key `super-mario-bros-hiscore`, inside `try/catch`. |

---

## 6. HUD (MUST, top 2 tile rows, original layout)

```
MARIO          ¢×00    WORLD    TIME
000000                  1-1      400
```
- The score is 6 digits. The coin counter is 2 digits with a coin icon that flashes. `WORLD w-s`. The `TIME` countdown shows 3 digits.

---

## 7. Mechanics

### 7.1 Mario Movement Physics (MUST: this is the most heavily judged area)

Horizontal (px/frame, px/frame²):

| Parameter | Value |
|-----------|-------|
| Max walk speed | 1.5625 |
| Max run speed (B held) | 2.5625 |
| Walk acceleration | 0.0371 |
| Run acceleration | 0.0557 |
| Release deceleration (no direction held) | 0.0508 |
| Skid deceleration (pressing opposite direction) | 0.1016 |
| Minimum walk start speed | 0.0742 |

- **Momentum:** Mario accelerates up to speed and slides to a stop. He does not start or stop instantly.
- **Skid:** when reversing direction at speed, show the skid sprite until his velocity reaches 0.
- **Running** needs B held. Release B and Mario decelerates to walk speed.
- **Air control:** left/right still changes velocity in mid-air, but **mid-air speed can't exceed the magnitude he had at takeoff** (or walk max if he took off from standing). Facing direction does **not** flip mid-air.

Vertical (**variable-height jump**, MUST):

| Horizontal speed at takeoff | Initial jump velocity (up) | Gravity while A held & rising | Gravity otherwise |
|-----------------------------|----------------------------|-------------------------------|-------------------|
| < 1.0 | 4.0 | 0.125 | 0.4375 |
| 1.0 – 2.31 | 4.0 | 0.1172 | 0.375 |
| > 2.31 | 5.0 | 0.1563 | 0.5625 |

- Maximum fall speed: **4.5 px/frame**.
- Releasing A early cuts the jump short. A full-speed running jump clears noticeably more height and distance than a standing jump. Holding A gives a full jump of about 4 tiles when small and standing, and about 5 tiles when running.
- **Stomp bounce:** after stomping an enemy, Mario's vertical velocity becomes −4.0 (up). If A is held, that bounce uses the low "A held" gravity, so the player can chain a high bounce.
- **Ceiling hits:** hitting a block from below stops upward motion straight away.

Collision:
- Tile-based AABB collision, resolving X and Y separately. Mario's hitbox is narrower than the sprite: about **12 px wide × 14 px tall** when small and **12 × 28** when big.
- **Corner forgiveness (SHOULD):** if Mario's head clips a block corner by 4 px or less, nudge him sideways instead of stopping the jump.
- Mario can't walk off the **left edge of the camera**.

### 7.2 Camera
- The camera scrolls **right only** and **never scrolls back left**.
- Start scrolling when Mario passes about 40% of the screen width. It tracks smoothly and never lets Mario get past about 50% of the screen.
- It clamps to the level's end.

### 7.3 Power-up States

| State | Size | Gains | On damage |
|-------|------|-------|-----------|
| Small Mario | 16 × 16 | — | Dies |
| Super Mario | 16 × 32 | Breaks bricks, can crouch | → Small |
| Fire Mario | 16 × 32 (white/red palette) | Throws fireballs | → **Small** (NES behaviour) |

- **Growing / shrinking:** freeze gameplay for about 1 s while the sprite flickers between sizes.
- **Damage invincibility:** about 2 s after taking damage, Mario flickers and passes through enemies.
- **Crouch** (big only): ↓ on the ground switches to the crouch sprite with a 16 px tall hitbox. He slides with momentum and can't walk.
- **Fireballs:** at most **2** on screen. Each travels at about 4 px/frame horizontally and bounces along the ground in low arcs. It explodes on hitting a wall or an enemy (killing it) and despawns off-screen.

### 7.4 Blocks & Items

| Block | Behaviour |
|-------|-----------|
| ? block | Animated flashing. When bumped from below, it gives out its content, bounces up about 4 px, and becomes a dead (brown) block. |
| Brick | **Small** Mario bumps it (it bounces, nothing breaks). **Big** Mario breaks it into 4 debris pieces (50 pts). |
| Multi-coin brick | Gives a coin per bump for about 4 seconds after the first bump (max about 10), then becomes a dead block. |
| Hidden block | Invisible until bumped from below. Contains a coin or a 1-Up. |
| Ground / hard block / pipe | Solid and indestructible. |

- A bumped block **kills or flips any enemy standing on it** (100 pts) and **pops up a coin** sitting on it.
- A coin from a block pops up, spins and vanishes (+1 coin, 200 pts).

| Item | Behaviour | Points |
|------|-----------|--------|
| Super Mushroom | Rises out of the block, slides at about 1 px/frame (initially away from Mario), falls off ledges, bounces off walls. Comes out as a **Fire Flower instead if Mario is already big**. | 1000 |
| Fire Flower | Stationary, animated palette | 1000 |
| Starman | Bounces along in high arcs. Gives about **10 s invincibility**: Mario flashes through palettes and kills enemies on contact (each worth the stomp-chain value). | 1000 |
| 1-Up Mushroom (green) | Moves like the Super Mushroom | +1 life, shows "1UP" |
| Coin (placed) | Collected on touch | 200, +1 coin |

- **100 coins → +1 life**, and the coin counter resets to 00.

### 7.5 Enemies

| Enemy | Behaviour | Defeat |
|-------|-----------|--------|
| **Goomba** | Walks at about 0.5 px/frame, reverses on walls and other enemies, **walks off ledges**. 2-frame walk animation. | Stomp (squashed sprite for about 0.5 s), fireball, shell, star, or block bump from below. |
| **Koopa Troopa (green)** | Walks, walks off ledges. | Stomp → **shell**. |
| **Koopa Troopa (red)** | Walks, **turns around at ledges**. | Stomp → shell. |
| **Koopa Paratroopa (red)** | Flies back and forth vertically or horizontally on a fixed path (1-3). | Stomp → becomes a walking Koopa. |
| **Koopa Paratroopa (green)** | Hops along the ground toward the player. | Stomp → walking Koopa. |
| **Piranha Plant** | Rises out of pipes and retreats on a cycle of about 2 s up, 2 s down. **Does not emerge while Mario is standing on or directly next to the pipe.** | Fireball, star (can't be stomped). |
| **Buzzy Beetle** | Like a Goomba but **immune to fireballs**. Stomp → shell. | Stomp, shell, star. |
| **Fire bar** | A chain of 6 fireballs rotating around a block (castle) at a constant angular speed. | Invulnerable. Contact causes damage. |
| **Bowser** (1-4) | Paces back and forth on the bridge, hops occasionally, and breathes **fire** (horizontal flame projectiles that drift toward Mario's height) every few seconds. | Touch the **axe** behind him to collapse the bridge (Bowser falls). Or hit him with **5 fireballs** (5000 pts, revealing a fake-Bowser Goomba). |

**Shells:**
- A stomped Koopa becomes a stationary shell. Touching it (or stomping it again) **kicks** it at about 3 px/frame in the direction away from Mario. A moving shell bounces off walls, **kills every enemy it hits** (chain scoring, see §9), and damages Mario if it hits him. Stomping a moving shell stops it.
- An untouched stationary shell revives into a Koopa after about 5 s, with legs wiggling as a warning in the last 1 s.

**Activation:** enemies are asleep until they come within about 1 tile of the right edge of the screen, and they despawn when more than about 3 tiles off the left edge. Enemies that aren't active never move.

**Damage rules:** touching an enemy from above while Mario is **falling** (and his feet are above the enemy's midpoint) counts as a stomp. Any other contact damages Mario.

### 7.6 Pipes
- Pipes are solid. Specific marked pipes (the 1-1 bonus pipe, the 1-2 exit pipe) can be entered by pressing ↓ (vertical pipe) or → (side pipe) while aligned. Mario slides into the pipe and the scene cuts to the linked area.

### 7.7 Pits & Death
- Falling below the bottom of the screen = death (even when big).
- Touching lava (1-4) = death.
- Time running out = death.

### 7.8 Timer
- It counts down **1 unit every 24 frames** (0.4 s).
- At **100 units**, the "hurry up" warning is shown visually (see §10).
- At **0**, Mario dies.

### 7.9 Level End
- **Flagpole (1-1, 1-2, 1-3):** on touching the pole, Mario grabs it and slides down while the flag lowers. The height he grabbed at awards points (§9), shown as a floating score. He then hops off, walks into the castle, and disappears. The **remaining time converts to points at 50 per unit**, counting down quickly (about 2 units/frame) with the HUD updating live.
  - **Fireworks (SHOULD):** if the timer's last digit is 1, 3 or 6 when Mario touches the pole, that many fireworks burst above the castle (500 pts each).
- **Castle (1-4):** touching the **axe** freezes Bowser, the bridge collapses tile by tile, and Bowser falls into the lava. Mario walks on to Toad, and the text **"THANK YOU MARIO! BUT OUR PRINCESS IS IN ANOTHER CASTLE!"** appears. The time bonus is tallied, then the next loop begins (§8).

### 7.10 Checkpoints
- Each stage has an invisible mid-stage checkpoint at about the halfway point. Dying after passing it respawns Mario there. The checkpoint resets on a new stage.

### 7.11 Lives
- Start with **3 lives**.

---

## 8. Levels & Difficulty Progression

### 8.1 Stage Content (MUST: 4 fully authored stages)

Store levels as data (for example arrays of strings, one character per tile, plus entity spawn lists), **not** as hand-coded draw calls. Each stage MUST be completable, with every jump achievable using the physics in §7.1.

**Stage 1 (World 1-1: Overworld)**, timer 400, about 210 tiles long. It MUST be recognisable as 1-1. Required landmarks, in order (column numbers are approximate):
1. Starting area with the large hill and bush scenery. Mario starts at about column 3.
2. At about column 16, a single **? block** (coin) at height 4 above the ground.
3. At about columns 20–24, the row `brick, ?(Mushroom), brick, ?(coin), brick` at height 4, with a single **? block (coin)** at height 8 above the middle ? block.
4. The **first Goomba** approaches around column 22.
5. **Four pipes of increasing height** at about columns 28 (2 tiles tall), 38 (3), 46 (4) and 57 (4). There are Goombas between the pipes, including a pair between the 3rd and 4th pipe.
6. A **hidden 1-Up block** at about column 64, height 5.
7. The **first pit** at about columns 69–70.
8. A brick and ? block section at about columns 77–95: a long elevated brick row at height 8 holding Goombas, a **multi-coin brick**, a **Starman brick**, and ? blocks, including a **Mushroom/Fire Flower ? block**.
9. A second pit at about columns 86–88.
10. A green Koopa Troopa around column 107, plus more Goombas.
11. The "?-block triangle": three ? blocks at height 4 and one at height 8, around columns 106–112.
12. **Two pairs of stone staircases** at about columns 134–150. The second pair has a pit between the staircases.
13. A pipe and a last few Goombas, at about columns 157–164.
14. The **final 8-step staircase** at about columns 181–189.
15. The **flagpole** at about column 198, standing on a single block, followed by the **small castle** at about column 202.
- **Bonus pipe (SHOULD):** the 4th pipe (column 57) leads to an underground coin room, and the room's exit pipe returns Mario near column 163.

**Stage 2 (World 1-2: Underground)**, timer 400. There's a black background, blue brick ceiling and blue ground. MAY start with the short overworld intro walk into a pipe. Required:
- A ceiling of bricks that Mario **can run on top of**.
- Brick and ? block clusters, including a multi-coin brick and a power-up.
- Goombas and green Koopas, including groups of Goombas in the low tunnels.
- **Several pipes with Piranha Plants.**
- Pits.
- **Moving lift platforms** (vertical, looping between the top and bottom of the screen) near the end.
- A side-entry **exit pipe** leading to a short overworld segment with the **flagpole** and castle.
- Warp Zone: MAY (if included, it just advances to the next stage).

**Stage 3 (World 1-3: Treetops / Athletic)**, timer 300. It uses the overworld palette and has **little solid ground**. Required:
- **Mushroom-top (treetop) platforms** of varying widths and heights over bottomless pits.
- **Horizontal and vertical moving platforms**, which carry Mario when he stands on them.
- **Red Koopa Paratroopas** flying on vertical paths and red Koopa Troopas on platforms.
- Coins placed along the jump arcs.
- A final staircase, the **flagpole** and the castle.

**Stage 4 (World 1-4: Castle)**, timer 300. Grey castle bricks and a black background. Required:
- Mario starts in a narrow corridor.
- **Lava pits** (animated surface) that must be jumped.
- **At least 5 fire bars**, with at least one rotating clockwise and one anticlockwise, and at least one long bar.
- Low ceilings in places that restrict how high Mario can jump.
- A ? block containing a power-up early in the stage.
- **The Bowser bridge** over lava, with Bowser and the axe beyond. The bridge is at least 13 tiles long.
- Then Toad and the end message (§7.9).

### 8.2 Loops & Progressive Difficulty (MUST)

After 1-4, the game **loops** back to stage 1 as the next **World** number (`WORLD 2-1`, `2-2`, … `3-1` and so on) with harder parameters. This is loosely based on the original's "Second Quest". Put all modifiers in one data table (for example `WORLD_MODIFIERS`).

| World (loop) | Enemy speed × | Goombas replaced by Buzzy Beetles | Timer adjustment | Fire bar speed × | Bowser | Extra hazards |
|--------------|---------------|-----------------------------------|------------------|------------------|--------|---------------|
| 1 | 1.00 | No | 0 | 1.0 | Fire only | — |
| 2 | 1.15 | **Yes** | −50 | 1.2 | Fire, more often (−25% interval) | Moving platforms 25% faster |
| 3 | 1.25 | Yes | −100 | 1.35 | Fire + **thrown hammers** | +1 extra enemy per ~20 tiles (at authored extra spawn points); Paratroopas replace some Koopas |
| 4+ | min(1.40, 1.25 + 0.05 × (W − 3)) | Yes | −100 (min timer 200) | min(1.6, …) | Fire + hammers, jumps more often | as World 3, and Piranha Plants emerge even when Mario is adjacent to the pipe |

Also:
- Stage 1-1 is always the easiest point. Each stage within a world SHOULD feel harder than the one before, as in the original's design.
- The `WORLD w-s` label on the HUD and level card reflects the loop.

---

## 9. Scoring

| Event | Points |
|-------|--------|
| Stomp / fireball / bump kill: Goomba | 100 |
| Stomp / fireball / bump kill: Koopa, Buzzy Beetle | 100 (fireball: 200) |
| Stomp Paratroopa (→ Koopa) | 400 |
| Fireball kill: Piranha Plant | 200 |
| Kicking a stationary shell | 400 |
| **Consecutive stomps without touching the ground** | 100, 200, 400, 500, 800, 1000, 2000, 4000, 5000, 8000, then **1UP** for each after |
| **Moving shell / Starman consecutive kills** | 500, 800, 1000, 2000, 4000, 5000, 8000, then 1UP for each after |
| Coin | 200 |
| Brick broken | 50 |
| Mushroom / Fire Flower / Starman collected | 1000 |
| Bowser killed by fireballs | 5000 |
| Flagpole (by grab height, bottom → top) | 100 / 400 / 800 / 2000 / **5000** (top) |
| Time bonus | 50 × remaining time units |
| Firework | 500 each |

- Every score award MUST show as **small floating text** at the event location, rising for about 1 s (the original did this).

---

## 10. Silent-Game Visual Cues

The original leans heavily on music and sound. Show these visually instead:

| Original audio cue | Required visual replacement |
|--------------------|-----------------------------|
| "Hurry up!" music at 100 time | MUST: the `TIME` digits flash red/white from 100 downward, and "HURRY UP!" appears briefly mid-screen. |
| Starman music | Mario's palette cycling (MUST) is enough. SHOULD also flicker faster in the final 2 s. |
| 1-Up jingle | Floating "1UP" text (MUST). |
| Power-up sprout sound | The item rising out of the block (MUST). |
| Pipe / damage / bump sounds | Their existing animations are enough. |
| Enemy hit by shell / fireball | The enemy **flips upside down** and falls off the screen (MUST, as in the original). |

---

## 11. Evaluation Hooks

| ID  | Requirement |
|-----|-------------|
| E-1 | MUST: when the page URL contains the hash `#level=N` (N ≥ 1), starting from the title screen begins at **level N**, where level N maps to world = `ceil(N / 4)` and stage = `((N − 1) mod 4) + 1`. So `#level=4` → 1-4 and `#level=5` → 2-1. The form `#level=W-S` (for example `#level=2-3`) MUST also be accepted. It starts with 3 lives and score 0. |
| E-2 | SHOULD: expose `window.game.getState()` returning `{ state, level, world, stage, score, lives, coins, time, power, highScore }`, a plain snapshot object. |
| E-3 | SHOULD: the hash `#debug` shows an overlay with FPS, Mario's x/y velocity, on-ground flag, tile coordinates, active enemy count and hitboxes. |

---

## 12. Code Quality Requirements

| ID   | Requirement |
|------|-------------|
| Q-1  | One `<script>` block, `'use strict'` (or `type="module"`). |
| Q-2  | Code is organised into clearly marked sections with header comments, for example: Config/Physics constants → Utilities → Input → Sprite & tile data → Level data → Tilemap & collision → Entities (Player, Enemies, Items, Projectiles, Platforms) → Camera → Scoring/HUD → State machine → Update → Render → Bootstrap. |
| Q-3  | All physics values from §7.1 and all timings, scores and world modifiers live in named constants or a config object near the top. No unexplained magic numbers in the logic. |
| Q-4  | Level layouts are **data** (for example string rows with a legend), not code. The tile legend is documented in a comment. |
| Q-5  | Entities share a common base or interface (for example `update()`, `render()`, a hitbox, `active`) and a shared tile-collision routine. Don't copy and paste physics per enemy. |
| Q-6  | No global-namespace pollution beyond one namespace object (plus the `window.game` hook). |
| Q-7  | Render only the tiles visible to the camera (culling). Pre-render sprites and tiles once at startup. |
| Q-8  | Descriptive names, small single-purpose functions, and comments that explain *why*, especially where you reproduce an NES quirk. |
| Q-9  | No dead code, commented-out code or leftover `console.log`. |
| Q-10 | No memory growth over a 30-minute session (pool or recycle particles, debris, floating texts). |
| Q-11 | Consistent formatting and indentation throughout. |

---

## 13. Out of Scope

Audio, Luigi or 2-player alternating play, worlds 2–8 of the original (their layouts), underwater stages, Lakitu, Hammer Bros. (as stage enemies), Bullet Bills, springboards, vines/beanstalk and cloud bonus areas, and the "continue" code. Touch and gamepad controls MAY be added but are not scored.

---

## 14. Acceptance Criteria (evaluator checklist)

1. [ ] The file opens offline from `file://` with no console errors. There are no network requests and no audio.
2. [ ] The title screen, level card (`WORLD 1-1`, `× 3`) and the original HUD layout (score, coins, world, time) are all present.
3. [ ] Mario has momentum, skidding, walk/run speeds, and a **variable-height jump**. A running jump goes clearly higher and farther. Mid-air control is limited as described.
4. [ ] The camera only scrolls right, and Mario can't go back past the left edge.
5. [ ] Stage 1 is recognisably World 1-1 (the ? blocks at the start, 4 rising pipes, hidden 1-Up, pits, staircases, flagpole, castle).
6. [ ] ? blocks, bricks (break only when big), multi-coin bricks, hidden blocks, and block-bump kills all work.
7. [ ] Mushroom → Super, Flower → Fire (fireballs, max 2, bouncing), Starman invincibility, 1-Up, and 100 coins → 1-Up all work.
8. [ ] Goombas, green and red Koopas (red turn at ledges), shells (kick, chain-kill, revive), Paratroopas and Piranha Plants all behave correctly.
9. [ ] Damage: Big/Fire → Small with invincibility frames. Small → death animation. Pits and lava kill.
10. [ ] The stomp chain and shell chain scoring escalate correctly, with floating score text.
11. [ ] The flagpole awards height-based points and the time bonus tallies. 1-4 ends with the axe, bridge collapse and Toad message.
12. [ ] Stages 1-2 (underground with lifts and piranhas), 1-3 (treetops with moving platforms) and 1-4 (lava, fire bars, Bowser) are complete and beatable.
13. [ ] The timer counts down, shows the hurry warning at 100, and kills Mario at 0. The mid-stage checkpoint works.
14. [ ] Looping to World 2 swaps Goombas for Buzzy Beetles and makes enemies faster. `#level=9` (3-1) is clearly harder than 1-1.
15. [ ] Pause works, and play auto-pauses on tab switch. Speed is identical on 60 Hz and high-refresh displays.
16. [ ] The high score persists across reloads. Game over returns to the title, and restart works without reloading the page.
