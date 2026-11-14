# Extending Baja Vehicle Designer

The app is plain JavaScript (ES modules) + [three.js](https://threejs.org). No framework — every feature is a small module you can read in one sitting.

## Project map

```
src/
  main.js                 wires store → analysis → checks → 3D view → UI
  core/
    store.js              design state, undo/redo, autosave
    defaults.js           starter frame, suspension hardpoints, starter parts, project migration
    commands.js           add/swap/delete/mirror parts, exports (CSV, XYZ)
    units.js              imperial formatting + parsing
    geom.js               vector helpers, oriented-box tests, linear solver
  catalog/                parts library (one file per category) + tube materials
  systems/
    chassis.js            nodes, tubes, joint angles, cut list
    fea.js                3D beam-element frame solver (stiffness, stresses, buckling)
    stresstest.js         Baja load cases, supports, pass/fail, integration gate
    cadImport.js          STEP/IGES/STL/CSV → tube frame (fit, join, apply)
    bentTube.js           bent tube body → straight runs meeting at virtual sharps
    suspension.js         suspension types + kinematic solver
    powertrain.js         CV shafts, driveshaft, gearing
    ergonomics.js         seated driver pose (IK, clearances, reach, seat fit)
    drivers.js            driver roster: body estimates from height, weight, gender
    routing.js            brake line / throttle cable routing
    integration.js        auto-linking parts (gearbox → CVT → engine)
    mass.js               weight + CG roll-up
    analysis.js           runs all of the above once per design change
  checks/                 design-rule checks, one file per subsystem
  view/                   three.js scene, 3D builders, overlays, mouse/keyboard tools
  ui/                     panels, inspector, library, dialogs, form fields
```

**Data flow:** every edit goes through `store.commit(label, fn)` (undoable). After each change, `integration.js` re-links dependent parts, `analysis.js` recomputes derived data once, `checks/` run on that snapshot, and the 3D view + panels re-render. Nothing else holds state, so a feature only needs to read `store.state` and `analysis()`.

## Add a part to the library

Add an object to the `register([...])` call in the matching `src/catalog/<category>.js` file:

```js
{
  key: 'hw.gopro',                      // unique id, saved in project files
  category: 'hardware',                 // chassis | dynamics | ergonomics | powertrain | hardware
  group: 'Electrical',                  // sub-heading in the library
  name: 'Camera mount + GoPro',
  summary: 'Onboard video for testing',
  role: 'camera',                       // optional: lets checks/integration find it
  singleton: false,                     // true = only one per car (adding another swaps it)
  params: [                             // editable in the inspector
    { key: 'arm', label: 'Arm length', type: 'length', default: 4, step: 0.25 },
    // types: length | angle | number (with unit) | select (options) | bool | color | text | textarea | hidden
  ],
  specs: (p) => [['Arm', fmtLen(p.arm)], ['Weight', fmtWeight(0.4)]],   // shown on hover + inspector
  weight: (p) => 0.4,                   // lb, used for weight + CG
  build: (p) => group(                  // geometry in inches, local origin = the part's reference point
    box(2.6, 1.8, 1.9, 0x222222, [0, 0, 1]),
    cylBetween([0, 0, 0], [0, 0, -p.arm], 0.3, 0x888888),
  ),
  ports: (p) => ({ mount: [0, 0, -p.arm] }),   // optional named connection points
}
```

Helpers (`box`, `cyl`, `cylBetween`, `sphere`, `lathe`, `plate`, `helix`, `group`, `mat`) live in `src/catalog/shapes.js`. Optionally give it a default mounting spot in `src/catalog/mounts.js`.

**Slot parts** (tires, shocks, calipers, rotors, racks, uprights) have `slot: 'tire'` etc. and a `data` object instead of `build`; see `src/catalog/dynamics.js`. Dropping one on the car assigns it to the nearest axle.

Teammates can also make parts without code: configure a *Custom block/cylinder* (or any part) and use **Save to My Parts** in the inspector.

## Add a design check

Create or edit a file in `src/checks/` and call `registerCheck`:

```js
import { registerCheck } from './index.js';

registerCheck({
  id: 'erg.camera', category: 'hardware', label: 'Camera present',
  run(state, A) {                       // A = analysis snapshot (segments, susp, parts, ergo, routes, mass…)
    const has = Object.values(state.parts).some((p) => p.def === 'hw.gopro');
    return has ? [] : [{
      severity: 'info',                 // error | warning | info
      title: 'No onboard camera',
      detail: 'Add one for test-day video.',
      targets: [],                      // [{ kind: 'member'|'node'|'part'|'hardpoint'|'route'|'axle', id }]
      fix: undefined,                   // optional { label, apply(state) } → shows a Fix button
    }];
  },
});
```

New check files must be imported once in `src/main.js`. Checks can be switched off per project in Settings.

## Add or change a stress-test load case

Load cases live in `CASES` in `src/systems/stresstest.js`:

```js
{ key: 'frontOffset', name: 'Front offset impact', dir: [-0.94, 0.34, 0], g: 5, blurb: 'Nose hits a post at 20°' }
```

- `dir` is the direction the force pushes (into the car). The joints on the impact face take the load; the far 20 % of the frame along `dir` is held.
- `side: true` uses the side-impact patch on SIM/LFS members; `kind: 'bump'` / `'torsion'` load the front suspension mounts and hold the rear ones.
- New cases appear in the Stress test panel automatically and count toward the integration gate. Projects pick up new case defaults on open (`migrate()`).

The solver itself is `src/systems/fea.js` (`buildModel` → `solveFrame`). `scripts/test-fea.mjs` checks it against closed-form beam results — add a check there if you change the element formulation.

## Improve CAD import

`src/systems/cadImport.js` is a pipeline of pure functions you can test in Node (`scripts/test-cad-import.mjs`):

1. `readCadFile` — STEP/IGES through occt-import-js (one mesh per solid), STL/OBJ split into connected shells, or a tube CSV.
2. `suggestOptions` — guesses units, up axis and front (roll-cage roof sits behind mid-car).
3. `fitTube` — principal axis + circle fits at both ends → axis, outer/inner radius (OD, wall) and a roundness residual. Sizes within a few thousandths of a standard OD or wall gauge snap to it (`snapTubeSize`).
4. `fitBentTube` (`bentTube.js`) — for bodies that aren't straight. Pairs of facet corners around the tube give centerline points (their angle-weighted normals meet on the centerline); shortest paths over the outer wall order them along the tube; stretches where the tube direction doesn't turn are straight runs, and consecutive runs meet at the virtual sharps. Close pairs of bends (U-bends, jogs, bends in two planes) get two sharps through the short straight between them. Bodies that aren't round tubes at all stay as reference.
5. `buildFrame` — extends each coped tube end to where its centerline meets a neighbor's (or snaps it to the virtual sharp of a bend it runs into), clusters joint estimates into nodes, ties lone ends to any tube they touch (`healJoints`: offset welds, T-joints on a tube that moved), and splits tubes at T-joints. `snapToCommonSizes` first evens out odd fits (a coped stub measuring 1.280 in for 1.250 in).
6. `applyImport` — reuses matching tube profiles, creates new ones, pairs mirror twins, and locks integration until the frame passes its stress tests.

`node scripts/inspect-cad.mjs <file> --stress` runs the whole pipeline on a real file and prints each body's fit, the rebuilt frame and the stress results. It's the fastest way to debug a file that doesn't convert well (see [CAD-IMPORT-TEST-REPORT.md](CAD-IMPORT-TEST-REPORT.md)). The stress tests run on the main connected frame (`mainFrame` in `stresstest.js`) and list any loose tubes rather than failing.

`scripts/lib/meshes.mjs` builds CAD-style tube meshes (straight, swept along a filleted polyline, or mitered, with only end rings on the straights like a CAD tessellator) and `scripts/lib/sampleFrame.mjs` turns the starter frame into test bodies — use them to add import tests.

## Add a tube material, stock profile or member role

- Materials, default profiles and member roles: `src/catalog/materials.js`.
- Teams can also add profiles per project from **Chassis ▸ Tube profiles ▸ New profile**.
- The primary-member equivalency math (`primaryEquivalency`) compares bending stiffness (E·I) and yield moment (Sy·I/c) against 1.0 × 0.120 in 1018 steel. Update the baseline there if the rulebook changes.

## Add a suspension type

Add an entry to `SUSP_TYPES` in `src/systems/suspension.js`:

- `points`: hardpoint keys with a label and a `body` — `chassis` (fixed), `upright` (moves with the hub), or an arm name (`lca`/`uca`, rotates with that arm).
- `links`: `[bodyPoint, chassisPoint]` pairs whose length stays constant.
- `joints`: spherical pivots where the upright body is pinned to a chassis point.
- The solver needs 5 constraints in total (e.g. 5 links, or 1 spherical joint + 2 links); wheel-center height drives the 6th degree of freedom.
- Add a template in `defaultSuspension()` (`src/core/defaults.js`) and drawing code in `buildCorner` (`src/view/build3d.js`).

## Change the driver body model

Teams enter their drivers in the Ergonomics tab (name, height, weight, gender, and optionally measured body lengths), so there is nothing to edit for a new driver. The model behind the estimates is in `src/systems/drivers.js`:

- `PROP` holds each body length as a fraction of standing height, per gender ("Not specified" averages the two). Seated hip width also grows with the square root of body-mass index.
- `driverBody()` turns a roster entry into what the posing code needs: lengths, shoulder and hip spacing, head size, and a girth factor (from BMI) that thickens the torso and limbs in the clearance checks and the 3D model.
- `MEASURES` lists the lengths a team can measure and type in; measured values replace the estimates.
- `migrateErgonomics()` upgrades projects saved with the old fixed design drivers (5th % female, 50th % and 95th % male) to an editable driver of the same size.

`scripts/test-drivers.mjs` checks the estimates against standard sizes and the roster-wide checks.

## Project files

A project is one JSON object (`schema`, `meta`, `chassis`, `suspension`, `parts`, …). When you change the format, bump `SCHEMA_VERSION` in `src/core/store.js` and upgrade old files in `migrate()` (`src/core/defaults.js`) so teammates' saved designs keep opening.

## Debugging

`window.baja` exposes `store`, `analysis()`, `issues()` and the viewport in the browser console, e.g. `baja.analysis().susp.front.stat` or `baja.store.state.chassis.members`.
