# HydGineer

**▶ Try it in your browser: [bibbi88.github.io/HydGineer](https://bibbi88.github.io/HydGineer/)**

A browser-based **hydraulic** circuit editor and simulator - the hydraulic sibling of
[PneuGineer](https://github.com/bibbi88/PneuGineerCL), built on the same editor. Drag pumps,
valves, cylinders and motors onto a canvas, wire them together and run the simulation: every
line shows its **pressure (bar)** and **flow (L/min)**, solved from the actual hydraulic
relationships rather than an on/off pressure graph.

## What is calculated

Each frame the whole circuit is solved as a network (damped Newton-Raphson with pseudo-transient
continuation, see `src/sim/hydraulics.ts`):

- **Continuity** at every line: what flows in flows out.
- **Orifice law** for valve paths, throttles and check valves: Q = Cd·A·√(2Δp/ρ)
  (Cd 0.62, ρ 870 kg/m³). Directional valves are rated as L/min per path at Δp 5 bar.
- **Pump**: Q = V·n minus pressure-dependent leakage (volumetric efficiency at rated pressure).
- **Relief valve**: shut below the cracking pressure, then passes the surplus flow.
- **Pressure-reducing valve**, **pressure-compensated flow control**, **pilot-operated check**.
- **Cylinders**: force balance p_A·A_A − p_B·A_B = F_load ± friction, speed v = Q/A; end stops.
- **Motors**: n = Q/V, Δp = 20π·T/V (bar, Nm, cm³/rev).
- **Flow dividers**: spool type - two metering orifices plus a compensating sleeve that
  settles where both orifices see the same Δp (split held whatever the loads, the lighter
  side throttled); rotary type - two gear sections on one shaft, flows in the ratio of their
  displacements, torque balance (p_P − p_A)·V_A + (p_P − p_B)·V_B = friction, internal
  leakage, and pressure intensification.
- **Accumulator**: gas law (p + 1)·V_gas^n = (p0 + 1)·V0^n, charging and discharging over time.
- **Counterbalance valve**: free flow in, opens for flow out when p_load + ratio·p_pilot ≥ setting.
- **Pressure-compensated pump**: displacement swivels back over the last few bar below the
  compensator setting, so it delivers only what the circuit takes.
- **Inertia**: optional moving mass per cylinder, m·dv/dt = net force, solved in 2 ms substeps -
  shows acceleration and the pressure peaks when a moving load is stopped.
- **Load sensing**: the LS pump holds its outlet at the highest load pressure (fed back on its
  LS port, through shuttle valves for several sections) plus a margin, with a pressure cut-off;
  proportional LS valves meter flow by spool stroke; a section compensator - built into the
  valve (off by default) or as a separate 2-way pressure compensator - holds a fixed Δp across
  each section's metering notch, so several sections share flow by lever position, not by load.
- **Compressibility** (bulk modulus 10 000 bar): trapped oil keeps its pressure and pressure
  builds up over time; steady states are the exact incompressible ones.

Units: bar (gauge), L/min, N, Nm, mm, cm³/rev.

## Components

- Power supply: pump unit, fixed, pressure-compensated or load-sensing variable displacement (motor can be
  switched by a relay or pressure switch), tank, gas-loaded accumulator
- Directional valves: 4/3 (closed / tandem / float / open centre) and 4/2, solenoid or hand lever;
  proportional load-sensing valve (lever slider or solenoids) with LS port; shuttle valve
- Pressure control: relief valve, pressure-reducing valve, counterbalance valve, 2-way pressure
  compensator (LS)
- Flow & check: check valve, pilot-operated check valve, throttle, one-way flow control,
  pressure-compensated flow control (optional bypass check), flow divider (spool with
  compensating sleeve, and rotary gear type)
- Actuators: double-acting cylinder, single-acting spring-return cylinder, hydraulic motor
- Measuring: pressure gauge, pressure switch (publishes a signal, e.g. S1)
- Electrical: +24 V / 0 V, push buttons, contacts, relay coils, solenoids, lamps, PLC

The **Examples** menu in the toolbar loads ready-made circuits (meter-out speed control,
electro-hydraulic control, motor speed control, load holding, and synchronising two
cylinders with each type of flow divider, accumulator charging, counterbalance valve,
pressure-compensated pump, inertia and pressure peaks, load sensing with one and two
sections, with and without pressure compensators). Flow dividers and directional valves
can be swapped type in place from the inspector, or by dropping the other type onto them.

## Running

```bash
npm install
npm run dev      # dev server
npm run test     # unit tests (solver checked against hand calculations)
npm run build    # single self-contained file: dist/index.html
```

The built `dist/index.html` runs offline by double-clicking it.
