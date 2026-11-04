# TURBOBALL graphics analysis (realism vs. real Rocket League footage)

Written 2026-11-04. Source material: the `bot training` folder.

- `screenshots/ours/` (23 frames, browser chrome cropped): from your two screen recordings. `nov01_*` is an early build (flat blue ramps, boxy crowd, no lights on the car). `nov02_*` is the current look (hex-livery car, orange/dark red walls, floodlights, neon goals). Two frames that were not game footage (a code editor and a school PDF) were deleted.
- `screenshots/real/` (43 frames): four real Rocket League videos (GC1 1v1 gameplay on a sunset stadium map, Dark's 1v1, a "best goals" montage, an aerial guide).
- `screenshots/comparisons/`: side-by-side, ours (left) vs real (right).

Code reviewed: `client/src/render/{carMesh,world,arenaMesh,environment}.ts`. Not read in detail: cage, flame, particles, postfx, skid, hud, camera (judged from the footage only).

## Verdict in one line
The current build (nov02) matches the real look well in composition and colour mood but is weaker in material realism. Layout, lighting mood, HUD, boost pads and camera feel are close. The car, ball, crowd and wall structure are what read as "low-poly web game".

## Scorecard (0-10, 10 = indistinguishable from the reference; my subjective estimates)

| Area | nov01 | nov02 | Notes |
|---|---|---|---|
| Sky / mood / colour grade | 6 | 8 | Sunset palette matches the reference stadium well. Ours is smoother and lacks real cloud detail. |
| Pitch markings and layout | 5 | 7 | Centre circle, boxes, dashed lines, lane colouring are right. Grass has little detail; the real pitch has mow stripes and bare worn patches. |
| Boost pads | 5 | 7 | Flame-topped pads read correctly. The real ones are flatter with a more orange flame. |
| Car model | 3 | 5 | Hex livery and gold wheels are distinctive but chunky; the body has hard box edges, the real car has smooth panels and a clear glass cabin. |
| Ball | 3 | 5 | Nov01: teal blob with a halo. Nov02: black ball with neon hex lines, which does not match the real dark metal-panel ball. |
| Walls / ramps | 3 | 5 | Nov01 ramps are flat saturated colour. Nov02 is better but the lower wall is a uniform dark red; real arenas show team-coloured panels, texture and ad boards. |
| Cage / fence | 4 | 6 | Nov02 thin posts and wire are close. Nov01's wire mesh was far too thick. |
| Crowd / stands | 2 | 4 | Rows of coloured boxes; the real crowd is dense with structure behind it (roofs, stairs, boards). |
| Scenery (towers, barn, tree) | 5 | 6 | Floodlights are good; the autumn tree is a faceted blob. |
| Boost / particle effects | 4 | 6 | Flame is readable. Real boost is a dual-jet flame with smoke and sparks. |
| Shadows / lighting | 4 | 6 | One sun shadow gives plausible car shadows. No floor reflections. |
| HUD | 7 | 8 | Scoreboard and boost ring are close in layout; the real boost gauge is more detailed. |

## What matches well
- Colour mood: purple-to-orange sunset with a warm key light matches the real stadium clips.
- Camera: ball cam framing, FOV and car-to-ball distance look like the real 1v1 footage (see `comparisons/01`).
- Field layout and markings, including the lane colouring and centre circle.
- Goal presentation: the neon frame with an LED label is an original take that still reads as a goal.
- Boost pad placement and the floating orb on the big pads.
- Post-processing (bloom, ACES tone mapping, grade) gives a cohesive look.

## Where it falls short (ranked by impact)
1. **Crowd.** Instanced boxes with flat colours on thin ledges (`environment.ts`). Fix: textured sprites or an atlas, plus a back wall and roof so the stands have depth.
2. **Ball.** Real ball: dark metal sphere with reflective panels. Ours has a strong emissive neon grid and a halo quad (`world.ts`); the halo shows a hard cut-off edge in `ours/nov01_08.jpg`. Fix: tone down emissive, fix the halo fade.
3. **Car silhouette.** Boxy slabs, oversized trim, wheels that look detached from the arches (`ours/nov02_06.jpg`). Fix: smoother shell, smaller trim, wheel arches that wrap the tyres.
4. **Walls.** Real walls are layered: coloured lower panel, textured band, ad boards. Ours is one colour band.
5. **Floor.** A single 2560x3200 canvas covers the whole pitch, so close up it is blurry (bottom of `ours/nov02_06.jpg`). Fix: overlay a tiled detail texture.
6. **Floating white blobs.** The soft round particles in `ours/nov02_06.jpg` look like snow/dust and are not in the reference.
7. **No ball/floor reflection**; the real game has a clear ball shadow and a slightly glossy pitch.

## Early build (nov01) problems that are already fixed in nov02
- Giant wire mesh filling the screen (`ours/nov01_05.jpg`).
- Flat, saturated blue/orange ramps.
- Plain car with red tail lights and no livery.

## Real-footage notes
- Real maps vary (underwater, Neo Tokyo, wasteland, stadium); the sunset stadium in `real_gc1_*` is the closest target to ours.
- Real HUD shows boost as a number in a segmented ring; real cars show visible suspension, rim glow and a boost trail with heat shimmer.

## Suggested next steps (cheapest first)
1. Fix the ball halo edge and reduce the ball's emissive.
2. Remove the floating soft particles near the camera.
3. Add a detail tile to the floor texture.
4. Add a second wall band and ad boards.
5. Rework the crowd into textured sprites.
6. Smooth the car body and refine the wheel arches.

## Limits
Judged from compressed 480p/720p video and from sampled frames (every 8 s for your recordings, every 30-120 s for the real videos), so rare effects such as goal explosions and demolitions were mostly not captured. Scores are estimates, not measurements.

## Round 2 changes (2026-11-04) - screenshots in `screenshots/after/`
- Car rebuilt as a smooth lofted hatchback body (rounded cross-sections, separate glass cabin and roof, wheel-well liners, flush slim head/tail lamps, silver rims, narrower wheels). Hex livery made subtle. See `car_v1` to `car_v4`.
- Stands: floating boxes replaced by raked, densely textured seating on all four sides.
- Goals: white hex net lining roof, sides and back.
- Ball: dark metal panels, faint edge lines, no halo. Pitch: tiled grass detail, glossier surface, stronger mow stripes. Sky: cloud seam fixed. Walls: second team-colour band.
- Dev tool added: `client/preview.html` (+ `src/preview.ts`) renders one car from any angle: `?az=-35&el=14&dist=330&team=1`.
- Not done / still different: no real planar floor reflections, car still simpler than the real Octane (no hood detail, side windows are one dark band), stands have no roofs/structure, ad boards on walls, tree is still a faceted blob. Physics untouched.

## Round 3 (2026-11-04)
- Car and ball reverted to the original look (carMesh.ts restored from git; ball texture/material/halo restored in world.ts).
- New `client/src/render/grass.ts`: 55k-90k short instanced blades that follow the camera, sway in the wind, and bend away from cars and the ball. Off on Low quality. Screenshots: `screenshots/after/grass_01` (too tall, rejected) and `grass_02` (kept).
- Still in place from round 2: dense sloped stands, goal nets, sky seam fix, glossier striped pitch, second wall band.

## Round 4: Neon City map (2026-11-04)
Grass removed (grass.ts deleted). The sunset farm stadium was replaced by a night cyberpunk city modelled on the cyberpunk map in the real footage (`real_insanity_01/05/06/08/09`).
- `client/src/render/neoncity.ts` (new): night sky with a white Voronoi wire dome, skyline of lit skyscrapers, glowing billboards (leaderboard, katakana signs, ads), magenta/violet/cyan haze, neon wire frames.
- `environment.ts`: wet black plaza ground, floodlight beams, old farm/hills/power lines removed. `world.ts`: night lighting, stronger bloom, fog. `postfx.ts`: teal/magenta grade + light chromatic aberration.
- `arenaMesh.ts`: cream wall panels, neon trim (blue/orange) along the wall top and ramp head, darker pitch with cyan boxes, live mirror reflection under a translucent floor (Medium and High only).
- Screenshots: `screenshots/after/neon_01` to `neon_03` (03 is current).
- Still to do: wall neon trim is hidden behind the stands from most angles, stands could be lower/glowier, car and ball were left as they were, and the goals still use the old metal tunnel.

## Round 5 (2026-11-04)
- **Toggle:** press B in a match (rebindable in Settings, plus a "Neon city background" checkbox). Off restores the original sunset stadium (now in `render/sunset.ts`). Choice is saved. `World.setNeon()` swaps scenery, lights, fog, bloom, colour grade, sky reflections, floor look and the ball.
- **Ball:** acid-lime panels with lime glow in neon mode; original dark ball in sunset mode.
- **Floor reflection:** cut to roughly a fifth (mirror tint 0x242732, floor opacity 0.94, floor roughness 0.85).
- **Backdrop rebuilt from the two reference images** (recreated procedurally, no images or logos embedded): kanji neon signs and ball medallions, neon-ringed cylinder towers with glowing caps, elevated monorail with blue neon, tanks and pipes, orange/white light beams, hovering drones, plus the earlier skyline, billboards, haze and Voronoi wire dome.
- Screenshots: `after/neon_04`, `toggle_on_neon`, `toggle_off_sunset`.

## Round 6 (2026-11-04)
- **Facades:** window atlas rebuilt as lit office floors with mullions and slabs; towers shade from glowing street level to dark roofs; 32% are cylinders; antennas with red aircraft lights; neon crown rings on tall round towers; a second, nearer ring of mid-rise blocks.
- **Sky:** finer, fainter Voronoi wire dome (no more jagged blocks).
- **Pitch (neon mode):** dark worn asphalt with plate seams, cracks, scuffs, orange/blue team lane paint, cyan neon centre line and circle, chevron fields in front of each goal. Sunset mode keeps the grass.
- **LED ring:** animated chasing LED board along the lower wall (blue half / orange half). **Goals:** chevron screens either side pointing at the net (neon mode only).
- Screenshots: `after/neon_05`, `after/neon_06` (current). Measured 60 FPS on the dev machine at medium quality.
- Next candidates: warmer floor tint, stand roofs/structure, rounded tech wall panels, animated window flicker, goal tunnel restyle.

## Round 7 (2026-11-04)
- **City rebuilt to match the reference art:** the ring of ~240 boxes is gone. Now 13 hero towers (bulging/tapering lathe towers and stepped slabs) plus a few hazy far silhouettes, with the kanji signs, billboards and medallions hung on the towers' faces. Monorail, tanks and drones kept. Windows flicker (shader, `cityTime`).
- **Ball (neon mode):** deep blue panels with cyan edge lines (darker than before, same blue family), not lime.
- **Car:** reflections cut (paint/glass env intensity, specular, clearcoat), underglow and sun/bloom reduced: the permanent white hotspot on the back is gone.
- **Floor:** reflection cut again (mirror tint 0x14161b, floor opacity 0.975); warmer grey asphalt with rusty brown wear stains.
- **Stands:** dark canopy roofs on support columns with a neon LED lip. **Goals:** dark tech tunnel, glowing hex back screen, ceiling light strips.
- Bug found and fixed: blurring thousands of tiny sky-line rects crashed WebGL ("context loss and was blocked"); now drawn once on a scratch canvas.
- Screenshots: `after/neon_10_drive`, `after/neon_11_ball` (ball close-up).

## Round 8 (2026-11-04): comparison against the two reference images
Verdict: NOT identical. See `screenshots/comparisons/05_ours-left_reference-right.jpg` (`after/cmp_A2_ingame`).
- Closer after this round: teal-black sky with a visible white hex dome, big close towers filling the background, dense warm street blocks, giant ball statue on a drum, gantry beams, brighter lit crowd, rust/orange paint on a dark worn pitch, bigger goal board.
- Still different: facades are procedural window grids (the references have detailed glass, balconies, pipes, ornaments); the wall is thin where the real one is thick glossy tech panels with LED dashes; no large "SCORE" LED screens, no round floodlight clusters, no painterly fog/volumetric light, no hanging pipes or airships from the concept art.
- Also this round: ball is cream #F2E8D5 with tan #B8A98A hex pattern (both scenes); graphics default is High (saved Medium is moved up once); visible "NEON CITY ON/OFF · B" button on the HUD, plus a pause-menu entry and the settings checkbox; dev camera `?devcam=px,py,pz,tx,ty,tz[,fov]`.

## Round 9: cars (2026-11-04)
- Body rebuilt as the boxy wagon from the three car references (grille, round headlights in angular housings, flared arches, side vents, thick bumper/splitter, roof spoiler, five-spoke dark wheels) in team colours. Screenshots: `after/fennec_v1..v4`, `fennec_ingame*`.
- Paint: electric blue 0x1a78ff / hot orange 0xff5a10; pearly metallic clearcoat with a colour-shifting sheen (iridescence), strong city reflections (envMapIntensity 1.5), softened sun specular so the old white hotspot stays gone. Glass, bumper, trim and chrome reflect too.
- Neon accent lines in team colour (cyan / amber) on the sills, belt line, hood bulge, grille brow and wheel arches.
- New reflection environment `neonEnvScene()` (neoncity.ts): night sky plus a ring of pink/cyan/orange light panels and overhead bars, used by the game and the preview page.

## Round 10 (2026-11-04)
- **Ball follows the scene:** neon city = cream #F2E8D5 / tan #B8A98A ball; sunset stadium = the original black-and-blue ball (swapped live by B / the HUD button).
- **Building detail:** finer window atlas (frames, blinds, glass gradients), balcony slabs with rails, vertical pipes with brackets, rooftop water tanks and AC units on the street blocks, huge curved pipes leaving every hero tower.
- **Wall:** thick glossy tech-panel lip (metal, seams, bolts, env reflections) with a chasing LED dash board on its face and neon trim on top.
- **SCORE screens:** large LED dot-matrix screens above each goal showing the live score (`World.setScore`).
- **Floodlights:** square lamps replaced by round 19-bulb clusters on dark discs.
- **Atmosphere:** drifting low fog banks (three layers, outside the pitch), light shafts kept, 3 airships with glowing undersides, hanging pipes under the gantries.
- Street-level camera check: `after/cmp_B2_street` (from the plaza at the foot of the towers). Main view: `after/cmp_A4_neon`.
- Still short of the references: painted/ornamental facade art, true glass reflections on buildings, billboards with video-like animation, volumetric god-rays (fog is simple additive layers).

## Round 11: goals (2026-11-04)
- Removed the "ORANGE GOAL / BLUE GOAL" LED label and its frame. The live SCORE screen above the goal stays.
- Goals rebuilt after the two goal references: thick rounded dark glossy frame (extruded rounded-rectangle ring) with outer and inner neon outlines in the team colour; silver bevelled wing panels inside the mouth with neon strips and lamp bulbs; dark hex-plate tunnel floor; glowing hex back screen and ceiling strips kept; old boxy header and pillars removed.
- Hex-plate decal on the pitch in front of each goal (neon mode only), fading out away from the goal.
- Screenshots: `after/goal_v1`, `after/goal_v2` (current).
- Still different from the references: the real goal is much larger on screen with a glassy translucent back shield and ribs, curved wing panels with rounded tops, and an arched floor ramp with neon edges.

## Round 12 (2026-11-04): windows and beams from the aerial reference
- Window atlas rebuilt: 8 floors x 8 bays per tile, dark concrete with a floor slab ledge, each floor a continuous lit ribbon (with mullions), a row of separate windows, or dim. One consistent cool-white (rarely warm) colour per floor. No more random multicolour on/off cells ("blocky lights"). Facade tints made calmer; flicker made rarer and tied to the 8x8 grid.
- Tall orange light columns (6) around the arena with a hot core and base glow; floodlight bulbs now HDR-bright so they bloom.
- Screenshot: `after/cmp_A5_windows`.

## Round 13 (2026-11-04)
- HUD scoreboard restyled after the reference: dark trapezoid timer plate with a white top edge, tilted glowing blue (left) and orange (right) score tiles with outlined digits.
- Overlaps fixed: LED dash strip no longer runs through the chevron screens; gantry pillars removed (they stood in front of billboards); hanging pipes removed; kanji signs no longer placed on top of billboards.
- Screenshots: `after/tour_1`, `after/tour_2`.

## Round 14 (2026-11-04)
- Root cause of buildings inside the arena: towers, street blocks, tanks and haze were placed on circular/elliptical rings, which cut through the rectangular stands at the corners and ends. New `clearOfStadium()` pushes every one of them out past the stand/floodlight footprint plus its own size. Checked from inside the arena: `after/clear_corner1`.

## Round 15 (2026-11-04)
- Secondary colours: blue team = subtle metallic violet (roof, hood, spoiler, accents, rims); orange team = subtle metallic red. Screenshots `after/livery_v3_blue`, `livery_v3_orange`.
- Camera (camera.ts): ball cam no longer swings round in front of the car when the ball is behind it (it fades back to the normal chase view); wall/ramp tilt limit cut from 65 to 30 degrees so the horizon stays readable. Check: `after/camera_check_b`.

## Round 16
- Billboards: the bright orange/pink gradient blocks are replaced by dark ad panels with a muted glow, thin neon frame, title and tagline ("TURBOBALL / CAR SOCCER LEAGUE", "NEON RAMEN / OPEN ALL NIGHT", "CITY CUP / LIVE TONIGHT"), alongside the existing HIGH SCORE board and kanji signs. Check: `after/billboards_v2`.

## Round 17
- Billboard "IB 45!" / "W SPEED": muted teal / amber / violet frames, warm-white text. The dark pole in front was a curved pipe leaving the tower on the arena-facing side; pipes now leave the far side. Signs and billboards only go on the big towers. End-zone floodlight towers moved off-centre. Check: `after/billboards_v5`.
- Pause (Escape) now suspends the whole audio context (engine, boost, crowd, effects), online and offline; resuming restores it.

## Round 18
- Removed the long black bars (elevated gantries and monorail) and the thin vertical light strips and antennas on the towers. The orange light columns stay. Check: `after/poles_removed`.

## Round 19
- Billboards were cut by buildings: the towers bulge out past the board, and other towers/blocks stood in the line of sight. Boards and signs now sit 1.32 x tower radius off the face and are only placed where no nearer building blocks the view from the arena (`onTower`). Checks: `after/billboards_v6`, `billboards_v7`.

## Round 20
- Billboards cut to two ("IB 45!", "W SPEED"); kanji signs and medallions kept.
- Buildings rebuilt as plain skyscrapers: straight glass cylinders and stepped slab towers (no bulging lathe shapes, no neon rings, no pink caps), grey-blue facades, an even office-window grid with whole floors lit, rooftop machinery boxes and tanks. Checks: `after/buildings_v3`, `buildings_v4`.
