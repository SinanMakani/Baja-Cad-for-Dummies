# Baja Vehicle Designer

A browser-based 3D layout tool for Baja SAE cars. Build the frame tube by tube, place suspension hardpoints, seat a driver, package the powertrain, and get design checks as you go. Everything is in imperial units (inches, pounds, degrees).

It is meant for **preliminary layout** — a shared visual basis before detailed CAD — not a replacement for SolidWorks/FEA or the rulebook.

## Run it

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173). Your work autosaves in the browser; use **File ▸ Save project** to get a `.baja.json` file you can commit to your team drive or Git.

To build a static site you can host anywhere (GitHub Pages, a team server, a shared drive):

```bash
npm run build
```

The `dist/` folder is the whole app. All paths are relative, so it works from any folder.

## Shared link

The team copy is a claude.ai Artifact: <https://claude.ai/artifact/8eKHEPqsPyj5esxGiFJzJD>. It starts private; the owner shares it from the page's **Share** menu. Work autosaves in each viewer's own browser, so pass designs around with **File ▸ Save project**.

**Settings ▸ Appearance** offers Auto, Light (*Soapstone*) and Dark (*Mill Scale*). Auto follows Claude's light or dark setting in the shared copy, and your computer's setting everywhere else.

Inside the artifact, exports go through claude.ai's save prompt, and each file needs a click to confirm. The prompt doesn't accept `.stl` or `.glb` files, so those download as a `.zip` that holds the file unchanged.

To update the shared copy, run `npm run build:artifact`, then have Claude publish `dist-artifact/index.html` with the files listed in `dist-artifact/artifact-files.json` to the same URL. Asset names change with each build, so remove the old ones from the artifact when you publish. This build leaves `dist/` alone. The only artifact-specific code is `src/platform/artifact.js`, which does nothing outside claude.ai.

## Coordinate system

- **+X forward, +Y to the driver's left, +Z up** (ISO 8855).
- Origin: on the ground, on the vehicle centerline, at the rear-axle line.
- Inputs accept `24.5`, `24 1/2`, `2' 6"`, `2ft 6in`, simple math (`12*2+0.5`) and metric (`600mm`, converted to inches).

## Design workflow: frame first

A new frame — started with **File ▸ New frame from scratch**, imported from CAD, or after **Clear frame** — must pass the **stress tests** before Dynamics, Ergonomics and Powertrain unlock. Until then those tabs show a lock, the Library only offers chassis parts, and the 3D view shows the frame alone. Once every load case passes, everything unlocks; if the frame changes later, the checks tray flags the results as out of date so you re-run them. The starter car comes already passing. A team lead can turn the requirement off per project in **Settings**.

## What each tab does

| Tab | What you do there |
| --- | --- |
| **Chassis ▸ Build frame** | Draw the frame point by point with the Tube tool: click joints or grid points, or type an exact length + elevation + plan angle, ΔXYZ or absolute XYZ. Mirror builds both sides. Select a joint to see (and set) every included angle between tubes; select a tube to set its exact length, angles, profile (OD × wall, material) and member role (RRH, RHO, SIM, FBM…). Cut list export includes coping angles at each end. |
| **Chassis ▸ Stress test** | Runs Baja impact cases on the frame: front, rear, left and right side, rollover onto the roof, rollover onto a roof corner (45°), hard landing through the front suspension, and torsion (one wheel up, reports torsional stiffness in lb·ft/deg). Add your own impact at any joint or tube from any direction. Tubes are colored by factor of safety, with load arrows, held joints and the exaggerated deflected shape; click a tube for its forces, von Mises stress, yield and buckling factors of safety. |
| **Chassis ▸ Import CAD** | Bring in a frame from SolidWorks. Each tube body becomes an editable tube with its measured length, OD and wall; bent tubes are split into their straight runs with a joint at each bend's virtual sharp; joints are rebuilt where the tubes meet; left/right twins are paired for mirror editing. The original geometry stays as a translucent reference (plates, gussets and brackets are shown in orange as reference only). Drop a file on the 3D view or use **File ▸ Import chassis from CAD**. |
| **Dynamics** | Front double A-arm and rear trailing arm + camber links (switchable per axle). Type hardpoints or drag them in 3D. Pick tires, shocks, calipers, rotors, uprights and the steering rack. The suspension is solved through bump, droop and steering: camber/toe curves, KPI, caster, scrub, trail, roll centers, bump steer, Ackermann, turning circle, motion ratio and shock stroke usage. |
| **Ergonomics** | Add each driver on your team by name, height, weight and gender. Body lengths are estimated from those, or type in values measured on the driver. Pick a seat and shell material, and place the seat, pedals and wheel. The selected driver poses itself with IK; every driver on the roster is checked for helmet and body clearance, pedal and wheel reach, and seat width, with a side-by-side fit table. Brake lines and the throttle cable route automatically along the frame. Driver's-eye camera view. |
| **Powertrain** | Place the gearbox; with Auto-link the CVT rides on the gearbox input at its center-line angle and the engine sits on the CVT primary. CV half-shafts (and a 4WD driveshaft + front CVs if you add a front differential) are generated with length, plunge and joint angles. Gearing, top speed and launch tractive force are calculated. |
| **Library** | All five categories — Chassis, Dynamics, Ergonomics, Powertrain, Hardware & Electrical. Hover a card for specs, drag it onto the car or click Add. Tires/shocks/brakes/racks/uprights assign to the front or rear suspension. Custom block/cylinder parts take any size, weight and spec text; **Save to My Parts** keeps a configured part in the project library. |

**Right panel (inspector):** full measurements, specs and exact editing for whatever you click. With nothing selected it shows total weight, CG, weight distribution and a weight breakdown.

**Design checks (bottom tray):** re-run on every change. Click **Show** to jump to the problem, hover to highlight it, and use **Fix** buttons where the tool can correct it (e.g. tie-rod height for bump steer). Turn individual checks on/off in Settings.

**View tools:** preset views (Iso/Front/Side/Top/Rear/Driver), X-ray, Focus (fades other subsystems in each tab), hover labels, section cut, layer toggles, frame coloring by role or profile, dimension lines and CG marker.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| V / N / T / S / M | Select · Node · Tube · Split · Measure |
| Shift (while drawing) | Snap tube angle to the angle step |
| Esc / right-click | End tube chain · cancel tool · clear selection |
| W / E | Move / rotate gizmo (parts) |
| R | Rotate selected part 90° about Z |
| F | Focus camera on selection |
| Del | Delete selection |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+D | Duplicate part |
| G | Toggle grid snap |
| X | Toggle X-ray |
| 1–5 | Switch tabs |

## Importing from SolidWorks

SolidWorks part and assembly files (`.SLDPRT`, `.SLDASM`) are a closed format that only SolidWorks can read, so export a neutral copy first:

1. In SolidWorks: **File ▸ Save As…**, set **Save as type** to **STEP AP214 (\*.step)**.
2. In the designer: **Chassis ▸ Import CAD** and choose the `.step` (or drop it on the 3D view).
3. Check the preview — units come from the STEP file; the up axis (SolidWorks is Y-up) and the front of the car are detected and can be flipped — then **Import**.

Weldment frames convert best: SolidWorks exports each structural member as its own solid. Also accepted: IGES, STL, OBJ, and a CSV of tube end points (`X1,Y1,Z1,X2,Y2,Z2,OD,Wall,Role` — the format **Export ▸ Tube endpoints** writes). Try it with `samples/starter-frame-solidworks-style.stl`, a SolidWorks-style export of the starter frame (millimeters, Y-up) whose roll hoop, front bracing and lower rails are bent tubes.

**Bent tubes.** A member bent from one tube — a weldment drawn along a filleted 3D sketch (with *Merge arc segment bodies*) or a swept tube — arrives as one solid. The importer finds its straight runs and puts a joint at each bend's *virtual sharp*, where the straight centerlines meet (the corner of the sketch before it was filleted), so the frame keeps the geometry it was designed with. The preview reports how many bends it found and the bend radius it measured. Tubes that weld onto a bend join at that bend's virtual sharp. In the stress tests a bend is a sharp corner, which is slightly stiffer than the real bend.

The STEP/IGES reader is [OpenCascade](https://dev.opencascade.org) compiled to WebAssembly ([occt-import-js](https://github.com/kovacsv/occt-import-js), LGPL-2.1). It downloads (≈8 MB) only the first time someone imports a STEP file. If an import says the reader couldn't be downloaded, reload the page (running locally, check that the dev server is still running).

Tubes welded beside another tube (centerlines that pass instead of meeting) are tied into the frame automatically. To see how a file converts without the browser, run `node scripts/inspect-cad.mjs "frame.step" --stress`. It lists every body (straight, bent or reference), the rebuilt joints and open ends, and the stress-test results. [docs/CAD-IMPORT-TEST-REPORT.md](docs/CAD-IMPORT-TEST-REPORT.md) is a worked example on a full SolidWorks weldment, with known limitations.

## How the stress tests work

- Each tube is a 3D beam element with its real round-tube section and material; welded joints are rigid. The frame is solved as a linear static structure (`src/systems/fea.js`, verified against textbook beam results by `npm test`).
- Impact loads are **g × design mass** (default 500 lb, vehicle + driver): front 6 g (≈25 mph stopped in 0.2 s), rear 4 g, side 3.5 g (≈20 mph), roof and roof-corner 3 g (≈3 ft drop), front landing 3 g through the front suspension mounts, torsion 1000 lb·ft. Every value is editable per case.
- The far 20 % of the frame is held, standing in for the inertia of the engine, driver and frame that resists a real impact. Side impacts load a 15 in bumper-width patch at mid-cockpit, shared by the side-impact member (SIM) and lower frame side (LFS). Landing and torsion load the front suspension pivots and hold the rear ones.
- Pass criteria: yield factor of safety ≥ 1.5 (Sy ÷ von Mises) and Euler buckling factor of safety ≥ 2.0, both adjustable.
- Real impacts are dynamic and welded joints concentrate stress. Use this to compare designs and catch weak tubes early; confirm the final frame with full FEA (ANSYS, SolidWorks Simulation).

## Exports

- **Cut list (CSV)** — every tube with profile, length (in and ft-in), weight, and the angle to each tube it meets at both ends (for coping).
- **Bill of materials (CSV)** — parts, suspension components, routed lines, frame tubing.
- **Chassis joints (XYZ)** — one point per line for SolidWorks *Curve Through XYZ Points* / 3D-sketch work.
- **Tube endpoints (CSV)** and **suspension hardpoints (CSV)**.
- **STL / GLB** 3D model (1 unit = 1 inch) and **PNG** screenshot.

## Accuracy notes

- Rule checks paraphrase common Baja SAE requirements (primary-member equivalency to 1.0 × 0.120 in 1018, helmet and body clearances, dual brake circuits, kill switches, firewall, fuel location, vehicle size). Rules change every year — **always confirm against the current rulebook**.
- Catalog dimensions and weights are typical starting values; verify against supplier data. Every value is editable.
- The driver model uses approximate anthropometric data; swap in your own drivers' measurements in `src/systems/ergonomics.js`.
- The kinematics solver treats links as rigid and joints as ideal spherical joints (no compliance).

## Tests

```bash
npm test
```

Checks the frame solver against closed-form beam results, runs every stress case on the starter frame, checks the driver body model and roster-wide ergonomics checks, and round-trips the starter frame through synthetic SolidWorks-style exports (STEP-style bodies, a single STL, CSV, and a version with the roll hoop, front bracing and lower rails bent from single tubes) to confirm the importer rebuilds every joint and tube. It also checks the shared link's save path (CSV straight through, STL/GLB wrapped in a `.zip`). `npm run sample` regenerates the sample STL.

## Extending

See [docs/EXTENDING.md](docs/EXTENDING.md) for adding parts, checks, load cases, materials, member roles and suspension types.
