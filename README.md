# HydGineer

**▶ Try it in your browser: [bibbi88.github.io/HydGineer](https://bibbi88.github.io/HydGineer/)**

**⬇ Download the desktop app:**
[Windows installer](https://github.com/bibbi88/HydGineer/releases/latest/download/HydGineer-Setup.exe) ·
[Linux AppImage](https://github.com/bibbi88/HydGineer/releases/latest/download/HydGineer.AppImage) ·
[Linux Flatpak](https://github.com/bibbi88/HydGineer/releases/latest/download/HydGineer.flatpak) ·
[standalone HTML file](https://github.com/bibbi88/HydGineer/releases/latest/download/HydGineer.html) ·
[all releases](https://github.com/bibbi88/HydGineer/releases)

A browser-based **hydraulic** circuit editor and simulator - the hydraulic sibling of
[PneuGineer](https://github.com/bibbi88/PneuGineer), built on the same editor. Drag pumps,
valves, cylinders and motors onto a canvas, wire them together and run the simulation: every
line shows its **pressure (bar)** and **flow (L/min)**, solved from the actual hydraulic
relationships rather than an on/off pressure graph.

## What is calculated

Each frame the whole circuit is solved as a network (damped Newton-Raphson with pseudo-transient
continuation, see `src/sim/hydraulics.ts`):

- **Continuity** at every line: what flows in flows out.
- **Orifice law** for valve paths, throttles and check valves: Q = Cd·A·√(2Δp/ρ)
  (Cd 0.62, ρ 870 kg/m³). Directional valves are rated as L/min per path at Δp 5 bar.
- **Throttles** can be given the way a datasheet states them: orifice diameter, a reference
  point (Q L/min at Δp bar), flow area (mm²), Kv (m³/h of water at 1 bar) or Cv (US gpm at
  1 psi); all become Q = K·√Δp, and the inspector shows what the setting amounts to.
- **Pump**: Q = V·n minus pressure-dependent leakage (volumetric efficiency ηv at rated
  pressure); the drive needs T = V·p / (20π·ηhm) and P = Q_geo·p / (600·ηhm) - the readout shows
  hydraulic and shaft power, shaft torque and the total efficiency ηtot = ηv·ηhm.
  A pump can be sized by its flow instead: the displacement follows from the motor speed.
- **Pressure source** (experimental): an ideal source giving up to a set flow, holding a set
  maximum pressure once the circuit takes less - for trying a circuit before choosing a pump.
- **Relief valve**: shut below the cracking pressure, then passes the surplus flow.
- **Pressure-reducing valve**, **pressure-compensated flow control**, **pilot-operated check**.
- **Cylinders**: force balance p_A·A_A − p_B·A_B = F_load ± friction, speed v = Q/A; end stops.
  The losses can be given as a friction force (N) or as a hydromechanical efficiency ηhm: the
  seals then take (1 − ηhm) of the driving chamber's force, so the rod gives F = p·A·ηhm.
- **Motors**: n = Q/V, Δp = 20π·T / (V·ηhm) (bar, Nm, cm³/rev) with the hydromechanical
  efficiency ηhm (default 90 %); hydraulic power in and shaft power out are shown.
- **Flow dividers**: spool type - two metering orifices plus a compensating sleeve that
  settles where both orifices see the same Δp (split held whatever the loads, the lighter
  side throttled); rotary type - two gear sections on one shaft, flows in the ratio of their
  displacements, torque balance (p_P − p_A)·V_A + (p_P − p_B)·V_B = friction, internal
  leakage, and pressure intensification.
- **Accumulator**: gas law (p + 1)·V_gas^n = (p0 + 1)·V0^n, charging and discharging over time.
- **Counterbalance valve**: free flow in, opens for flow out when p_load + ratio·p_pilot ≥ setting.
- **3-way pressure compensator** (load sensing with a fixed pump): lets the surplus oil to tank
  at the LS pressure plus its Δp, so the fixed pump idles at that Δp in neutral.
- **Steering unit (Orbitrol)**: open centre in neutral; turning the wheel at n rev/s, the
  gerotor meters Q = D · n into L or R while the open centre holds the pump just above the load.
  Built-in inlet check, relief and suction valves; with the pump stopped it steers by hand (the
  readout shows the wheel torque).
- **Sequence valve**: shut until its inlet reaches the setting, then opens and holds the inlet
  there while passing the oil on; drained spring chamber, optional bypass check for the return.
- **Pressure-compensated pump**: displacement swivels back over the last few bar below the
  compensator setting, so it delivers only what the circuit takes.
- **Inertia**: optional moving mass per cylinder, m·dv/dt = net force, solved in 2 ms substeps -
  shows acceleration and the pressure peaks when a moving load is stopped.
- **Load sensing**: the LS pump holds its outlet at the highest load pressure (fed back on its
  LS port, through shuttle valves for several sections) plus a margin, with a pressure cut-off;
  proportional LS valves meter flow by spool stroke; a section compensator - built into the
  valve (off by default) or as a separate 2-way pressure compensator - holds a fixed Δp across
  each section's metering notch, so several sections share flow by lever position, not by load.
- **Hydrostatic transmission**: an over-centre pump (flow = swash × displacement × speed, either
  direction, leakage to case drain) drives a motor in a closed loop; a charge pump tops up the
  low side through make-up checks, cross-port relief valves limit the high side.
- **Variable-displacement motor**: displacement set by a slider between a minimum stop and the
  maximum; smaller displacement gives n = Q/V faster and Δp = 20π·T/V higher at the same power.
- **Compressibility** (bulk modulus 10 000 bar): trapped oil keeps its pressure and pressure
  builds up over time; steady states are the exact incompressible ones.

Units: bar (gauge), L/min, N, Nm, mm, cm³/rev.

## Components

- Power supply: pump unit, fixed, pressure-compensated or load-sensing variable displacement;
  over-centre pump for closed loops (motor can be
  switched by a relay or pressure switch), tank, gas-loaded accumulator, filter (with bypass check)
- Directional valves: 4/3 (closed / tandem / float / open centre) and 4/2, solenoid or hand lever;
  3/2 for single-acting cylinders (normally closed or open), by hand lever, solenoid or roller -
  the roller pressed by a cylinder sensor;
  proportional load-sensing valve (lever slider or solenoids) with LS port; shuttle valve; steering unit (Orbitrol)
  with a steering wheel
- Pressure control: relief valve, cross-port relief valves, pressure-reducing valve,
  counterbalance valve, sequence valve, 2-way pressure compensator (LS), 3-way pressure
  compensator (LS with a fixed pump)
- Flow & check: check valve, pilot-operated check valve, throttle, one-way flow control,
  pressure-compensated flow control (optional bypass check), flow divider (spool with
  compensating sleeve, and rotary gear type)
- Actuators: double-acting cylinder (single rod, or double rod for steering - chosen in its inspector), single-acting spring-return cylinder, hydraulic motor
  (fixed or variable displacement)
- Measuring: pressure gauge, flow meter (flow and volume passed), pressure switch (publishes a
  signal, e.g. S1)
- Electrical: +24 V / 0 V, push buttons, contacts, relay coils, solenoids, lamps, PLC

The **Examples** menu in the toolbar loads ready-made circuits (meter-out speed control,
electro-hydraulic control, motor speed control, load holding, and synchronising two
cylinders with each type of flow divider, accumulator charging, counterbalance valve,
clamp-then-press with a sequence valve, pressure-compensated pump, inertia and pressure peaks, load sensing with one and two
sections, with and without pressure compensators, load sensing with a fixed pump, hydrostatic steering with an Orbitrol, hydrostatic transmission with fixed or
variable motor). Flow dividers, pumps, motors, directional valves, check valves and throttles /
flow controls can be swapped type in place from the inspector, or by dropping the other type onto
them.

Several circuits can be open at once, as **tabs** above the canvas (or listed in the inspector -
see **Settings**, the gear in the toolbar), each with its own undo history. Examples and loaded
files open in a new tab. Every open circuit is kept in the browser (IndexedDB) and is back after a
reload; Save all saves every tab at once. **Export several circuits** (the ▾ beside Export) exports
the tabs you tick as one PDF with a page each, a PDF each, PNG or SVG images - each circuit's page
frame or its whole diagram, fitted to the page or at a zoom of 25-400 %, on A4, A3 or each
frame's own paper; several files go into a folder you choose (Chrome, Edge, the desktop app) or
are downloaded. **Show the pages** previews each one as it will come out; click a page to give that
circuit its own area, zoom and paper. The single Export has the same zoom.

**Open** opens a project file; the ▾ beside it lists the five most recently opened or saved
files (Chrome, Edge and the desktop app) and the examples. The toolbar shows each button's name
under its icon - **Settings → Toolbar** switches to icons only.

**Saving** works as in a desktop program: the first **Save** (Ctrl+S) asks where, and later
Saves write back to that file without asking; **Save as** (Ctrl+Shift+S, or the ▾ beside Save)
picks a new file, and later Saves go there. The button reads "Save as" until the circuit has a
file. This needs a browser that can write files - Chrome or Edge - or the desktop app; Firefox
and Safari download the file on every save. In the browser the link to a file lasts until the
page is reloaded (the first Save after that asks again); the desktop app remembers it.

Drawing: wires snap to a port within 16 px, a wire let go on another joins it with a tap
junction without cutting it, and crossing wires get ISO line jumps. Live pressure/flow labels
keep clear of the other wires, symbols and readouts. Cylinders mark the sensors something reads
(a0, a1...) at the rod, lit while on during a run. Pictures can be pasted, dropped or chosen onto
the canvas, and a run can be recorded as a video (the record button while simulating).

## Running HydGineer

There are four ways to run the app, from simplest to most involved.

### 1. In the browser

Open [bibbi88.github.io/HydGineer](https://bibbi88.github.io/HydGineer/). Nothing to install.
The site is rebuilt and redeployed automatically on every push to `main`.

### 2. Offline, from a single file

The production build is one self-contained HTML file, [`dist/index.html`](dist/index.html), with
all scripts and styles inlined.
[Download it](https://github.com/bibbi88/HydGineer/releases/latest/download/HydGineer.html)
(`HydGineer.html`, from the latest release) and double-click it to open it in your browser. It
needs no server and no internet connection, so it can be copied to a USB stick or shared by email.

### 3. As a desktop app (Windows, Linux)

The same app in its own window, without a browser - it opens and saves project files (`.hgcl`)
like any desktop program, and greets you with recent files and the examples.

- **Windows:** download the
  [installer](https://github.com/bibbi88/HydGineer/releases/latest/download/HydGineer-Setup.exe)
  and run it. It isn't code-signed, so Windows SmartScreen may warn that it's from an unknown
  publisher: choose **More info → Run anyway**. Once installed it **updates itself**: at start
  it asks GitHub for a newer version, downloads it in the background and offers to restart into
  it (or installs it when the app is closed).
- **Linux, AppImage:** download the
  [AppImage](https://github.com/bibbi88/HydGineer/releases/latest/download/HydGineer.AppImage),
  make it executable (`chmod +x HydGineer.AppImage`, or Properties → Allow executing) and run
  it - one file, nothing to install. Like the Windows app it **updates itself**. Ubuntu 24.04
  and later need the FUSE library once: `sudo apt install libfuse2t64`.
- **Linux, Flatpak:** download the
  [Flatpak](https://github.com/bibbi88/HydGineer/releases/latest/download/HydGineer.flatpak),
  then `flatpak install --user HydGineer.flatpak` and start HydGineer from the app menu (or
  `flatpak run io.github.bibbi88.HydGineer`). The Freedesktop runtime it needs is fetched from
  Flathub on install.

**Internet use.** HydGineer doesn't use the internet - the web app loads nothing from
anywhere once open, and your circuits never leave your device. The one exception is the update
check of the Windows app and the Linux AppImage, an ordinary download request to GitHub at
start. It can be turned off under **Settings → Updates**, after which the app never connects to
the internet. The Linux Flatpak doesn't update itself (use `flatpak update`, or install a newer
file) and never goes online.

**Flathub:** the files for publishing HydGineer on Flathub - the manifest, metadata, desktop
entry and file type - are in [`flathub/`](flathub/), with how to release and submit it.

Both are built by GitHub Actions ([`.github/workflows/desktop.yml`](.github/workflows/desktop.yml))
from [`desktop/`](desktop/) - an Electron shell around the built `dist/index.html` - on every push
to `main`, into the [latest release](https://github.com/bibbi88/HydGineer/releases/latest). The
links above always fetch the newest. For a numbered release of its own, push a version tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow can also be run by hand on any branch (**Actions → Desktop apps → Run workflow**);
such a run keeps the installer, the Flatpak and the HTML file as downloadable artifacts, without
a release.

### 4. From source

Requires [Node.js](https://nodejs.org/) 22 or newer.

```bash
npm install
npm run dev      # dev server
npm run test     # unit tests (solver checked against hand calculations)
npm run build    # single self-contained file: dist/index.html
npm run lint     # eslint + prettier check
```
