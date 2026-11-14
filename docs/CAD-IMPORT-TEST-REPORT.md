# CAD import test report: `Chassis Baja File.STEP`

**Date:** 2026-11-08
**File:** `Chassis Baja File.STEP`, exported from SolidWorks 2025 as STEP AP214. The part inside is "Chassis FINAL - Pete".
- Size and units: 4.0 MB, inches.
- Bodies: one multi-body weldment part with 71 solid bodies.
- Faces: 502 cylindrical (straight tube walls), 112 toroidal (bends) and 40 planar (cut ends).

**Method:** the file was imported in the app (Chassis ▸ Import CAD, local dev server) and through the same code in Node with `node scripts/inspect-cad.mjs "Chassis Baja File.STEP" --stress`. The converted frame was then put through the eight stress-test cases. Each problem found was fixed, given a regression test, and re-checked against the file.

## Result

| | Before the fixes | After |
| --- | --- | --- |
| Bodies recognized as tubes | 59 of 71 | **70 of 71** (59 straight, 11 bent with 18 bends, bend radius 3.1–4.7 in) |
| Kept as reference only | 12 (every bent tube) | 1 (a 1 in long sleeve) |
| Rebuilt frame | 67 joints, 84 tubes, **3 separate pieces, 22 open tube ends** | 77 joints, 121 tubes, **one connected frame, no open ends** |
| Tube sizes found | 1.000 × 0.035, 1.000 × 0.065, 1.250 × 0.065 | the same, every tube within 0.001 in of a standard size |
| Stress tests | 4 of 8 cases could not run ("frame is not held together") | all 8 cases run (results below) |
| Time | | read 2.4–3.8 s, convert 0.4 s; 3.4–8 s in the browser including the reader download |

Front of the car (−X in SolidWorks), up axis (Y) and units (inches) were all detected correctly. The rebuilt frame is 86 in long, 38 in wide and 48 in tall.

## Errors found and fixed

| # | What happened | Cause | Fix |
| --- | --- | --- | --- |
| 1 | Import stopped with *"Failed to fetch dynamically imported module …/occt-import-js.js"* | The local dev server had stopped while the page was still open. The STEP reader is downloaded only when it's first needed, so the page couldn't fetch it. The file itself was fine. | The error now explains this and shows a **Reload page** button (`loadOcct` in `src/systems/cadImport.js`). The reader is also bundled when the server starts (`optimizeDeps` in `vite.config.js`), so a restart can't leave an open page asking for an outdated copy. |
| 2 | All 12 bent tubes were kept as orange reference | A few facets on coped ends gave wild radius estimates. The wall split latched onto them and found a 9.4 in "tube". | Inner and outer wall radius now come from the two tallest peaks of an area-weighted histogram (`twoRadii` in `src/systems/bentTube.js`). |
| 3 | Bent-tube centerlines doubled back (fake 160–180° "bends") | CAD tessellation uses long, thin facets. Pairs of points far apart along a facet are numerically unstable, and facets touching at one shared vertex linked clusters two straights apart. | Centerline points are now found in the tube's cross-section plane, skipping pairs more than 2.5× longer along the tube than around it. Clusters are linked only through shared facet edges, ordered by hops that follow the tube direction, and 1–2 facet strays are dropped. |
| 4 | A 64° elbow with no straight section (body 63) wasn't recognized | The recognizer needed at least one straight run. | Pure arcs are now followed with chords (4 chords here). |
| 5 | 22 tube ends left open | Some tubes are welded beside another tube, so their centerlines pass about 1 in apart instead of meeting. Some T-joints landed on a tube whose end had been snapped to a bend's virtual sharp, which moved that tube's line by 1.8–2.3 in. | A joint-repair pass (`healJoints` in `cadImport.js`) ties a lone tube end to any tube it touches, checking both the rebuilt and the original centerline. 15 ends in this file were tied in this way. |
| 6 | One loose tube made every stress case fail | The stiffness matrix is singular when any piece floats free. | Stress tests now run on the main connected frame. Left-out tubes are listed in the Stress test panel and in Design checks (`mainFrame` in `src/systems/stresstest.js`). |
| 7 | Straight tubes could be rejected or stretched by stray points | The straight fit used a mean-based wall split, a standard-deviation roundness check, and min/max end positions. | It now uses histogram peaks for the walls, a 90th-percentile roundness check, and tube ends measured on the outer wall. |
| 8 | A 1.5 in coped stub measured 1.280 in OD and would have created its own tube profile | Short tubes with coped ends fit a few percent off. | Sizes within 3 % (OD) or 0.006 in (wall) of a size at least three other tubes use snap to it. |
| 9 | Coincident points from adjacent STEP faces could fail to merge | Rounded-coordinate keys split points that sit on a grid boundary. | Vertex welding now checks neighboring grid cells (`weldVertices`). |
| 10 | IGES files were labeled "STEP" in the import panel | The label was hard-coded. | The label is now IGES for .iges and .igs files. |

## Stress tests on the imported frame

Settings are the defaults: 500 lb design mass, factor-of-safety targets 1.5 against yield and 2.0 against buckling. Tube roles were not tagged yet, so every tube is "SEC". Coordinates below are in the app's frame after import (in inches, rear of the frame at X = −14, lowest tube at Z = 9.4).

| Case | Result | Weakest tube | Assessment |
| --- | --- | --- | --- |
| Front impact | **Pass**, FoS 1.63 | 1.0 × 0.035, 16.1 in | |
| Rear impact | Fail, FoS 1.39 | 1.0 × 0.035 brace, 12.5 in, (−13.5, −3.0, 18.0) → (−9.7, −7.5, 29.0) | Real, just under the 1.5 target. The rear section is all 1.0 × 0.035. |
| Side impact (left / right) | Fail, FoS 0.45 / 0.46 | 1.0 × 0.035, 25.7 in, at Z = 22.5 in | **Depends on tagging.** No tube is tagged SIM, so the test loaded the mid-height side rails. If these 1.0 × 0.035 tubes really are the side-impact members, they are far below the primary-member requirement. If not, tag the real SIM tubes and re-run. |
| Rollover, roof | **Pass**, FoS 3.91 | | |
| Rollover, roof corner (45°) | Fail, FoS 1.16 | 1.25 × 0.065 roof tube, 15.7 in, from the roll-hoop corner (4.2, 11.2, 57.0) | Real. Bracing that roof corner or shortening that span would help. |
| Landing on the front suspension | Fail, FoS 0.35 | 1.0 × 0.035 near the rear supports | **Not meaningful yet.** The suspension pivots aren't placed on this frame, so the test loads 23 front joints as stand-ins. |
| Torsion (one wheel up) | Fail, FoS 0.87 | 1.0 × 0.035 near the rear supports | Not meaningful yet, for the same reason. |

## Known limitations and errors to expect

1. **Landing and torsion need the suspension pivots, but Dynamics is locked until the frame passes.** For an imported frame, untick those two cases in Chassis ▸ Stress test until the suspension is placed, or turn off "Require stress tests" in Settings. *Suggested fix:* let the user pick the front and rear mount joints in the stress-test panel.
2. **Imported tubes have no roles.** Primary-member checks don't apply until tubes are tagged, and the side-impact case has to guess the rails. Tag RRH, RHO, FBM, LFS, SIM and LC after importing. *Suggested fix:* suggest roles from geometry.
3. **Bends become sharp corners at their virtual sharps.**
   - A tube welded onto the curved part of a bend is moved to the sharp: up to about 1.4 in for a 79° bend with a 4.6 in radius.
   - Members joined there swing slightly.
   - The stress model is a little stiffer than the real bend.
4. **Merged mitered members.** In SolidWorks this is "Merge miter trimmed bodies".
   - Miters up to about 25° are recognized; sharper ones stay orange reference. They're flagged, never wrong.
   - Workaround: export with the members left as separate bodies, which is SolidWorks' default.
5. **Very short pieces** such as sleeves, plugs or stubs under about 1.5 tube diameters stay reference-only (body 50 here).
6. **Large files.**
   - The STEP reader runs on the page's main thread, so the page freezes while reading. That was about 3 s for this 4 MB file.
   - A whole-car assembly with engine, wheels and hardware could take 30 s or more and use a lot of memory.
   - Export just the frame part. *Suggested fix:* read in a Web Worker with a progress bar.
7. **Published (shared) version.** The 8 MB STEP reader downloads the first time someone imports. If a new version is published while a teammate has the page open, their import can show the same "couldn't be downloaded" error; reloading fixes it.
8. **Running locally.** Keep `npm.cmd run dev` running (PowerShell blocks plain `npm` scripts on this computer). If it stops, imports fail with error 1 above.
9. **Detecting the front.**
   - The importer assumes the roll-cage roof sits behind the middle of the car.
   - A frame without a roof, or one with the cage well forward, could come in backwards.
   - Check the preview and use *Flip front ↔ back*.
10. **Units.** STEP files carry their units. STL files don't, so the unit is guessed from size; check the preview.

## Re-running these checks

```bash
node scripts/inspect-cad.mjs "Chassis Baja File.STEP" --stress
```

This prints every body (straight, bent or reference, with sizes and bend angles), the rebuilt frame (joints, tubes, open ends, connected pieces) and the stress results, without opening the browser. Add `--json out.json` to save the frame.

```bash
npm test
```

The test suite includes a regression test for each problem above:
- vertex jitter and stray facets
- 1.0 × 0.035 thin walls
- elbows
- mitered bodies
- offset welds
- a loose tube in the stress test

It also runs this file automatically whenever `Chassis Baja File.STEP` is in the project folder.
