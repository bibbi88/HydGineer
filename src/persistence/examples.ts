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
function powerUnit(b: Builder, px: number, py: number, setting = 100): number {
  const pump = b.add('hydPump', px, py, { displacement: 10, speed: 1450, etaV: 95 });
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
];
