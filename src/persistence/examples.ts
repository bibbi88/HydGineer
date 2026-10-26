import type { ProjectFileV1, ComponentSnapshot, ConnectionSnapshot } from './schema';

/** Small builder so the example circuits below read as a parts list plus a wiring list. */
function circuit(name: string, build: (b: Builder) => void): ProjectFileV1 {
  const comps: ComponentSnapshot[] = [];
  const conns: ConnectionSnapshot[] = [];
  let next = 1;
  const b: Builder = {
    add(type, x, y, data = {}, rot) {
      const id = next++;
      comps.push({ id, type, x, y, data, ...(rot ? { rot } : {}) });
      return id;
    },
    wire(a, ap, c, cp) {
      conns.push({
        from: { id: a, port: ap },
        to: { id: c, port: cp },
        guides: [],
        stubStartLen: null,
        stubEndLen: null,
      });
    },
  };
  build(b);
  return { schemaVersion: 1, name, comps, conns };
}

interface Builder {
  add(type: string, x: number, y: number, data?: Record<string, unknown>, rot?: number): number;
  wire(a: number, ap: string, b: number, bp: string): void;
}

/** Pump with relief valve and gauge, feeding P of a valve; returns the junction on the supply
 * line so the caller can wire the valve to it. Pump at (px, py). */
function powerUnit(
  b: Builder,
  px: number,
  py: number,
  setting = 100,
  pumpData: Record<string, unknown> = {},
): number {
  const pump = b.add('hydPump', px, py, { displacement: 10, speed: 1450, etaV: 95, ...pumpData });
  const j = b.add('junction', px - 10, py - 110, { orientation: 'H' });
  const relief = b.add('hydRelief', px - 130, py - 60, { setting });
  const tank = b.add('hydTank', px - 130, py + 40);
  const gauge = b.add('hydGauge', px - 70, py - 150, { range: 250 });
  b.wire(pump, 'P', j, 'P');
  b.wire(j, 'P', relief, 'P');
  b.wire(relief, 'T', tank, 'T');
  b.wire(j, 'P', gauge, 'P');
  return j;
}

/** Load-sensing pump (max 40 L/min, 20 bar margin, 250 bar cut-off) with a safety relief valve
 * and a gauge. Returns the supply junction and the pump (whose LS port the valves feed). */
function lsUnit(b: Builder, px: number, py: number): { p: number; pump: number } {
  const pump = b.add('hydPumpLS', px, py, {
    displacement: 28,
    speed: 1450,
    margin: 20,
    compSetting: 250,
  });
  const j = b.add('junction', px - 10, py - 110, { orientation: 'H' });
  const relief = b.add('hydRelief', px - 130, py - 60, { setting: 270 });
  const tank = b.add('hydTank', px - 130, py + 40);
  const gauge = b.add('hydGauge', px - 70, py - 150, { range: 250 });
  b.wire(pump, 'P', j, 'P');
  b.wire(j, 'P', relief, 'P');
  b.wire(relief, 'T', tank, 'T');
  b.wire(j, 'P', gauge, 'P');
  return { p: j, pump };
}

export const EXAMPLES: Array<{ title: string; file: () => ProjectFileV1 }> = [
  {
    title: 'Cylinder, hand lever valve, meter-out',
    file: () =>
      circuit('Example - cylinder meter-out', (b) => {
        const supply = powerUnit(b, 260, 520);
        const valve = b.add('hydValve43', 420, 330, {
          actuation: 'lever',
          center: 'tandem',
          qNom: 30,
        });
        const tank = b.add('hydTank', 520, 410);
        const fc = b.add('hydOneWayFlowControl', 530, 200, { diameter: 1.5 });
        const cyl = b.add('hydCylinderDouble', 450, 60, {
          bore: 50,
          rodD: 30,
          stroke: 300,
          load: 8000,
          friction: 200,
          showName: true,
        });
        b.wire(supply, 'P', valve, 'P');
        b.wire(valve, 'T', tank, 'T');
        b.wire(valve, 'A', cyl, 'A');
        b.wire(valve, 'B', fc, 'OUT');
        b.wire(fc, 'IN', cyl, 'B');
      }),
  },
  {
    title: 'Electro-hydraulic: 4/3 solenoid valve, push buttons',
    file: () =>
      circuit('Example - electro-hydraulic', (b) => {
        const supply = powerUnit(b, 260, 520, 120);
        const valve = b.add('hydValve43', 420, 330, {
          actuation: 'solenoid',
          center: 'closed',
          keyLeft: 'Y1',
          keyRight: 'Y2',
          qNom: 30,
        });
        const tank = b.add('hydTank', 520, 410);
        const cyl = b.add('hydCylinderDouble', 440, 160, {
          bore: 63,
          rodD: 36,
          stroke: 250,
          load: 15000,
          friction: 300,
          showName: true,
        });
        b.wire(supply, 'P', valve, 'P');
        b.wire(valve, 'T', tank, 'T');
        b.wire(valve, 'A', cyl, 'A');
        b.wire(valve, 'B', cyl, 'B');

        const plus = b.add('elecRailPlus', 800, 120);
        const zero = b.add('elecRailZero', 800, 520);
        const s1 = b.add('elecPushButton', 760, 250);
        const s2 = b.add('elecPushButton', 880, 250);
        const y1 = b.add('elecSolenoid', 760, 400, { key: 'Y1' });
        const y2 = b.add('elecSolenoid', 880, 400, { key: 'Y2' });
        b.wire(plus, 'P', s1, 'A');
        b.wire(plus, 'P', s2, 'A');
        b.wire(s1, 'B', y1, 'A');
        b.wire(s2, 'B', y2, 'A');
        b.wire(y1, 'B', zero, 'P');
        b.wire(y2, 'B', zero, 'P');
      }),
  },
  {
    title: 'Hydraulic motor, pressure-compensated flow control',
    file: () =>
      circuit('Example - motor speed control', (b) => {
        const supply = powerUnit(b, 260, 520, 150);
        const valve = b.add('hydValve42', 420, 330, { actuation: 'lever', qNom: 30 });
        const tank = b.add('hydTank', 520, 410);
        const fc = b.add('hydFlowControl', 410, 180, { qSet: 8, bypass: true });
        const motor = b.add('hydMotor', 430, 40, { displacement: 16, torque: 15 }, 0);
        b.wire(supply, 'P', valve, 'P');
        b.wire(valve, 'T', tank, 'T');
        b.wire(valve, 'A', fc, 'IN');
        b.wire(fc, 'OUT', motor, 'A');
        b.wire(valve, 'B', motor, 'B');
      }),
  },
  {
    title: 'Load holding: pilot-operated check valve',
    file: () =>
      circuit('Example - load holding', (b) => {
        const supply = powerUnit(b, 260, 520);
        const valve = b.add('hydValve43', 420, 330, {
          actuation: 'lever',
          center: 'float',
          qNom: 30,
        });
        const tank = b.add('hydTank', 520, 410);
        const poc = b.add('hydPilotCheck', 400, 190, { ratio: 4 });
        const cyl = b.add('hydCylinderDouble', 440, 60, {
          bore: 50,
          rodD: 30,
          stroke: 300,
          load: 6000,
          friction: 100,
          showName: true,
        });
        b.wire(supply, 'P', valve, 'P');
        b.wire(valve, 'T', tank, 'T');
        b.wire(valve, 'A', poc, 'A');
        b.wire(poc, 'B', cyl, 'A');
        const jb = b.add('junction', 530, 230, { orientation: 'H' });
        b.wire(valve, 'B', jb, 'P');
        b.wire(jb, 'P', cyl, 'B');
        b.wire(jb, 'P', poc, 'X');
      }),
  },
  {
    title: 'Synchronising two cylinders: spool flow divider',
    file: () =>
      syncCircuit('Example - spool flow divider', 'hydSpoolDivider', { ratioA: 50, qNom: 15 }),
  },
  {
    title: 'Synchronising two cylinders: rotary flow divider',
    file: () =>
      syncCircuit('Example - rotary flow divider', 'hydRotaryDivider', {
        dispA: 8,
        dispB: 8,
        leakAt100: 0.3,
        friction: 0.5,
      }),
  },
  {
    title: 'Accumulator: charging, cut-out by pressure switch, fast stroke',
    file: () =>
      circuit('Example - accumulator', (b) => {
        // A small pump (4 L/min) charges a 2 L accumulator through a check valve until the
        // pressure switch S1 trips at 120 bar and stops it ("!S1" = run while S1 is off). The
        // cylinder then strokes much faster than the pump alone could drive it.
        const supply = powerUnit(b, 160, 560, 140, { displacement: 2.8, signal: '!S1' });
        const check = b.add('hydCheck', 300, 450, {}, 90);
        const js = b.add('junction', 410, 450, { orientation: 'V' });
        const acc = b.add('hydAccumulator', 380, 340, { volume: 2, precharge: 60, n: 1.4 });
        const ps = b.add('hydPressureSwitch', 470, 380, { setting: 120, key: 'S1' });
        const valve = b.add('hydValve43', 640, 340, {
          actuation: 'lever',
          center: 'closed',
          qNom: 60,
        });
        const tank = b.add('hydTank', 700, 430);
        const cyl = b.add('hydCylinderDouble', 680, 120, {
          bore: 50,
          rodD: 30,
          stroke: 300,
          load: 5000,
          friction: 150,
          showName: true,
        });
        b.wire(supply, 'P', check, 'IN');
        b.wire(check, 'OUT', js, 'P');
        b.wire(js, 'P', acc, 'P');
        b.wire(js, 'P', ps, 'P');
        b.wire(js, 'P', valve, 'P');
        b.wire(valve, 'T', tank, 'T');
        b.wire(valve, 'A', cyl, 'A');
        b.wire(valve, 'B', cyl, 'B');
      }),
  },
  {
    title: 'Lifting and lowering a load: counterbalance valve',
    file: () =>
      circuit('Example - counterbalance valve', (b) => {
        // 20 kN hangs on the cap side (63.7 bar holds it); the valve is set at 85 bar with a 4:1
        // pilot from the rod-side line, so lowering needs the pump to drive the load down.
        const supply = powerUnit(b, 260, 600, 160);
        const valve = b.add('hydValve43', 420, 420, {
          actuation: 'lever',
          center: 'tandem',
          qNom: 30,
        });
        const tank = b.add('hydTank', 520, 500);
        const cbv = b.add('hydCounterbalance', 400, 260, { setting: 85, ratio: 4, qNom: 30 });
        const cyl = b.add('hydCylinderDouble', 470, 70, {
          bore: 63,
          rodD: 36,
          stroke: 400,
          load: 20000,
          friction: 200,
          showName: true,
        });
        const jb = b.add('junction', 560, 300, { orientation: 'H' });
        b.wire(supply, 'P', valve, 'P');
        b.wire(valve, 'T', tank, 'T');
        b.wire(valve, 'A', cbv, 'V');
        b.wire(cbv, 'L', cyl, 'A');
        b.wire(valve, 'B', jb, 'P');
        b.wire(jb, 'P', cyl, 'B');
        b.wire(jb, 'P', cbv, 'X');
      }),
  },
  {
    title: 'Clamp first, then press: sequence valve',
    file: () =>
      circuit('Example - sequence valve', (b) => {
        // Both cylinders hang on the same A line. The clamp needs only ~8 bar to move, so the
        // pressure stays low while it closes; the sequence valve, set at 60 bar, only lets oil
        // on to the press once the clamp has stopped against the part and the pressure rises.
        // Back again, both retract together - the press's return oil through the bypass check.
        const supply = powerUnit(b, 260, 640, 140);
        const valve = b.add('hydValve43', 420, 480, {
          actuation: 'lever',
          center: 'closed',
          qNom: 30,
        });
        const tank = b.add('hydTank', 520, 560);
        const clamp = b.add('hydCylinderDouble', 300, 100, {
          bore: 40,
          rodD: 22,
          stroke: 100,
          load: 1000,
          friction: 100,
          showName: true,
          customName: 'Clamp',
        });
        const press = b.add('hydCylinderDouble', 640, 100, {
          bore: 63,
          rodD: 36,
          stroke: 200,
          load: 10000,
          friction: 200,
          showName: true,
          customName: 'Press',
        });
        const seq = b.add('hydSequence', 600, 290, { setting: 60, qNom: 30, check: true });
        const drainTank = b.add('hydTank', 720, 360);
        const ja = b.add('junction', 380, 370, { orientation: 'H' });
        const jb = b.add('junction', 480, 330, { orientation: 'H' });
        b.wire(supply, 'P', valve, 'P');
        b.wire(valve, 'T', tank, 'T');
        b.wire(valve, 'A', ja, 'P');
        b.wire(ja, 'P', clamp, 'A');
        b.wire(ja, 'P', seq, 'P');
        b.wire(seq, 'A', press, 'A');
        b.wire(seq, 'L', drainTank, 'T');
        b.wire(valve, 'B', jb, 'P');
        b.wire(jb, 'P', clamp, 'B');
        b.wire(jb, 'P', press, 'B');
      }),
  },
  {
    title: 'Clamping with a pressure-compensated pump',
    file: () =>
      circuit('Example - pressure-compensated pump', (b) => {
        // Once clamped, the variable pump swivels back to almost zero flow at 100 bar instead of
        // dumping its whole flow over the relief valve (now only a safety valve at 140 bar).
        // Switch the pump's Displacement to "Fixed" in the inspector to compare the power.
        const supply = powerUnit(b, 260, 560, 140, { control: 'pc', compSetting: 100 });
        const valve = b.add('hydValve43', 420, 380, {
          actuation: 'lever',
          center: 'closed',
          qNom: 30,
        });
        const tank = b.add('hydTank', 520, 460);
        const cyl = b.add('hydCylinderDouble', 450, 160, {
          bore: 63,
          rodD: 36,
          stroke: 150,
          load: 2000,
          friction: 200,
          showName: true,
        });
        b.wire(supply, 'P', valve, 'P');
        b.wire(valve, 'T', tank, 'T');
        b.wire(valve, 'A', cyl, 'A');
        b.wire(valve, 'B', cyl, 'B');
      }),
  },
  {
    title: 'Inertia: stopping a 5 t mass mid-stroke',
    file: () =>
      circuit('Example - inertia and pressure peaks', (b) => {
        // A 5000 kg slide moving at ~0.12 m/s. Return the lever to centre mid-stroke: the mass
        // runs on into the trapped oil on the rod side and the pressure there peaks far above
        // anything the pump delivers, while the cap side pressure collapses.
        const supply = powerUnit(b, 260, 560, 100);
        const valve = b.add('hydValve43', 420, 380, {
          actuation: 'lever',
          center: 'closed',
          qNom: 30,
        });
        const tank = b.add('hydTank', 520, 460);
        const cyl = b.add('hydCylinderDouble', 450, 160, {
          bore: 50,
          rodD: 30,
          stroke: 600,
          load: 0,
          friction: 300,
          mass: 5000,
          showName: true,
        });
        b.wire(supply, 'P', valve, 'P');
        b.wire(valve, 'T', tank, 'T');
        b.wire(valve, 'A', cyl, 'A');
        b.wire(valve, 'B', cyl, 'B');
      }),
  },
  {
    title: 'Load sensing: one proportional section',
    file: () =>
      circuit('Example - load sensing', (b) => {
        // Move the lever slider under the valve while simulating: the flow (and the cylinder's
        // speed) follows the lever, whatever the load, and the pump runs at only the load
        // pressure + its 20 bar margin. In neutral the pump idles at standby.
        const supply = lsUnit(b, 260, 560);
        const valve = b.add('hydValveLS', 460, 380, { actuation: 'lever', qNom: 40 });
        const tank = b.add('hydTank', 540, 470);
        const cyl = b.add('hydCylinderDouble', 500, 150, {
          bore: 63,
          rodD: 36,
          stroke: 500,
          load: 15000,
          friction: 200,
          showName: true,
        });
        b.wire(supply.p, 'P', valve, 'P');
        b.wire(valve, 'T', tank, 'T');
        b.wire(valve, 'LS', supply.pump, 'LS');
        b.wire(valve, 'A', cyl, 'A');
        b.wire(valve, 'B', cyl, 'B');
      }),
  },
  {
    title: 'Load sensing: two sections and a shuttle valve',
    file: () =>
      circuit('Example - load sensing, two sections', (b) => {
        // Two sections on one LS pump; the shuttle valve sends the higher load signal to the
        // pump. Without compensators the pump only holds Δp across the heavier section, so the
        // light one (5 kN against 25 kN) gets a far bigger Δp and takes most of the oil. Tick
        // "Section pressure compensator" on both valves - or see the next example - to fix it.
        const supply = lsUnit(b, 200, 620);
        const v1 = b.add('hydValveLS', 420, 420, {
          actuation: 'lever',
          qNom: 30,
          compensated: false,
        });
        const v2 = b.add('hydValveLS', 840, 420, {
          actuation: 'lever',
          qNom: 30,
          compensated: false,
        });
        const t1 = b.add('hydTank', 500, 510);
        const t2 = b.add('hydTank', 920, 510);
        const shuttle = b.add('hydShuttle', 680, 580);
        const cylData = { bore: 50, rodD: 30, stroke: 400, friction: 150, showName: true };
        const c1 = b.add('hydCylinderDouble', 460, 170, { ...cylData, load: 5000 });
        const c2 = b.add('hydCylinderDouble', 880, 170, { ...cylData, load: 25000 });
        b.wire(supply.p, 'P', v1, 'P');
        b.wire(supply.p, 'P', v2, 'P');
        b.wire(v1, 'T', t1, 'T');
        b.wire(v2, 'T', t2, 'T');
        b.wire(v1, 'LS', shuttle, 'X1');
        b.wire(v2, 'LS', shuttle, 'X2');
        b.wire(shuttle, 'OUT', supply.pump, 'LS');
        b.wire(v1, 'A', c1, 'A');
        b.wire(v1, 'B', c1, 'B');
        b.wire(v2, 'A', c2, 'A');
        b.wire(v2, 'B', c2, 'B');
      }),
  },
  {
    title: 'Load sensing: two sections with separate pressure compensators',
    file: () =>
      circuit('Example - load sensing with pressure compensators', (b) => {
        // The same two sections, each with a 2-way pressure compensator in front of its P port,
        // piloted by its own LS line. Each compensator holds its valve's inlet 10 bar above that
        // section's load, so both cylinders move at their levers' speed whatever the other one
        // does - try running one into its end stop.
        const supply = lsUnit(b, 200, 700);
        const sections = [
          { x: 420, load: 5000 },
          { x: 880, load: 25000 },
        ].map(({ x, load }) => {
          const valve = b.add('hydValveLS', x, 420, { actuation: 'lever', qNom: 30 });
          const comp = b.add('hydPressureCompensator', x - 20, 540, { setting: 10, qNom: 40 });
          const ls = b.add('junction', x + 20, 540, { orientation: 'H' });
          const tank = b.add('hydTank', x + 80, 510);
          const cyl = b.add('hydCylinderDouble', x + 40, 170, {
            bore: 50,
            rodD: 30,
            stroke: 400,
            friction: 150,
            load,
            showName: true,
          });
          b.wire(supply.p, 'P', comp, 'IN');
          b.wire(comp, 'OUT', valve, 'P');
          b.wire(valve, 'T', tank, 'T');
          b.wire(valve, 'LS', ls, 'P');
          b.wire(ls, 'P', comp, 'LS');
          b.wire(valve, 'A', cyl, 'A');
          b.wire(valve, 'B', cyl, 'B');
          return ls;
        });
        const shuttle = b.add('hydShuttle', 700, 640);
        b.wire(sections[0]!, 'P', shuttle, 'X1');
        b.wire(sections[1]!, 'P', shuttle, 'X2');
        b.wire(shuttle, 'OUT', supply.pump, 'LS');
      }),
  },
  {
    title: 'Hydrostatic transmission (closed loop)',
    // An over-centre pump drives the motor in a closed loop: the swash-plate slider beside the
    // pump sets the motor's speed and direction steplessly, through zero.
    file: () =>
      hstCircuit('Example - hydrostatic transmission', 'hydMotor', {
        displacement: 40,
        torque: 60,
      }),
  },
  {
    title: 'Hydrostatic transmission with variable motor',
    // The same loop with a variable-displacement motor (slider beside it): with the pump at full
    // swash, turning the motor's displacement down raises its speed further - and the pressure
    // its load torque needs, until the cross-port relief valves stop it (below ~42 % with ηhm 90 %).
    file: () =>
      hstCircuit('Example - hydrostatic transmission, variable motor', 'hydMotorVar', {
        displacement: 40,
        minPct: 30,
        setting: 100,
        torque: 60,
      }),
  },
];

/**
 * Hydrostatic transmission: the over-centre pump's swash-plate slider sets the motor's speed and
 * direction. The motor's return oil goes straight back to the pump's inlet. A small charge pump
 * (9 L/min, 20 bar) keeps the low-pressure line topped up through the make-up check valves,
 * replacing what leaks to the pump's case drain; the cross-port relief valves limit the high side.
 */
function hstCircuit(name: string, motorType: string, motorData: Record<string, unknown>) {
  return circuit(name, (b) => {
    const pump = b.add('hydPumpLoop', 300, 360, { displacement: 28, speed: 1500 });
    const motor = b.add(motorType, 1020, 360, motorData);
    const cross = b.add('hydCrossRelief', 860, 360, { setting: 250 });
    const gA = b.add('hydGauge', 520, 240, { range: 400 });
    const gB = b.add('hydGauge', 520, 390, { range: 400 });
    // Junctions along the upper (A) and lower (B) loop lines.
    const top = [520, 620, 860].map((x) => b.add('junction', x, 290, { orientation: 'V' }));
    const bot = [520, 700, 860].map((x) => b.add('junction', x, 430, { orientation: 'V' }));
    b.wire(pump, 'A', top[0]!, 'P');
    b.wire(top[0]!, 'P', top[1]!, 'P');
    b.wire(top[1]!, 'P', top[2]!, 'P');
    b.wire(top[2]!, 'P', motor, 'B');
    b.wire(pump, 'B', bot[0]!, 'P');
    b.wire(bot[0]!, 'P', bot[1]!, 'P');
    b.wire(bot[1]!, 'P', bot[2]!, 'P');
    b.wire(bot[2]!, 'P', motor, 'A');
    b.wire(gA, 'P', top[0]!, 'P');
    b.wire(gB, 'P', bot[0]!, 'P');
    b.wire(cross, 'A', top[2]!, 'P');
    b.wire(cross, 'B', bot[2]!, 'P');
    // Charge circuit: the charge line runs between the loop lines; one make-up check opens
    // up into the A line, the other down into the B line - whichever is the low side.
    const charge = b.add('hydPump', 660, 700, { displacement: 6, speed: 1500 });
    const jC = b.add('junction', 650, 360, { orientation: 'H' });
    const jR = b.add('junction', 650, 540, { orientation: 'H' });
    const chargeRelief = b.add('hydRelief', 480, 580, { setting: 20 });
    const chargeTank = b.add('hydTank', 480, 720);
    const ckA = b.add('hydCheck', 620, 330);
    const ckB = b.add('hydCheck', 700, 390, {}, 180);
    b.wire(charge, 'P', jR, 'P');
    b.wire(jR, 'P', jC, 'P');
    b.wire(jR, 'P', chargeRelief, 'P');
    b.wire(chargeRelief, 'T', chargeTank, 'T');
    b.wire(jC, 'P', ckA, 'IN');
    b.wire(ckA, 'OUT', top[1]!, 'P');
    b.wire(jC, 'P', ckB, 'IN');
    b.wire(ckB, 'OUT', bot[1]!, 'P');
  });
}

/** Two equal cylinders with very different loads (3 kN and 15 kN) fed through a flow divider
 * from a lever valve, so they extend together - the B sides return through a junction. */
function syncCircuit(name: string, dividerType: string, dividerData: Record<string, unknown>) {
  return circuit(name, (b) => {
    const supply = powerUnit(b, 260, 560, 120);
    const valve = b.add('hydValve43', 420, 380, { actuation: 'lever', center: 'tandem', qNom: 30 });
    const tank = b.add('hydTank', 520, 460);
    const divider = b.add(dividerType, 390, 240, dividerData);
    const cylData = { bore: 50, rodD: 30, stroke: 300, friction: 150, showName: true };
    const cylA = b.add('hydCylinderDouble', 280, 60, { ...cylData, load: 3000 });
    const cylB = b.add('hydCylinderDouble', 620, 60, { ...cylData, load: 15000 });
    const jb = b.add('junction', 700, 300, { orientation: 'H' });
    b.wire(supply, 'P', valve, 'P');
    b.wire(valve, 'T', tank, 'T');
    b.wire(valve, 'A', divider, 'P');
    b.wire(divider, 'A', cylA, 'A');
    b.wire(divider, 'B', cylB, 'A');
    b.wire(cylA, 'B', jb, 'P');
    b.wire(cylB, 'B', jb, 'P');
    b.wire(jb, 'P', valve, 'B');
  });
}
