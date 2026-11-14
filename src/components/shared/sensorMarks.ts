import { createSvgEl } from './svgHelpers';
import { isInSensorRange, isSensorLabelBound, type CylinderSensor } from './sensorPositions';

/**
 * A cylinder's sensor marks, as circuit diagrams draw them: for each sensor something actually
 * reads (a limit valve or contact bound to a0, a1...), a short tick where the rod end trips it,
 * with the sensor's name over it - so the diagram shows which switch sits where along the
 * stroke. `tipAt(pos)` is the rod tip's centre x at stroke position `pos` (0 in, 1 out), and the
 * ticks run down to just above the rod tip at `tipTop`.
 */
export function drawSensorMarks(
  group: SVGGElement,
  sensors: CylinderSensor[],
  tipAt: (pos: number) => number,
  tipTop: number,
): void {
  group.replaceChildren();
  for (const sensor of sensors) {
    if (!isSensorLabelBound(sensor.label)) continue;
    const x = tipAt((sensor.minPct + sensor.maxPct) / 200);
    group.append(
      createSvgEl('line', {
        x1: x,
        y1: tipTop - 18,
        x2: x,
        y2: tipTop - 2,
        stroke: '#111',
        'stroke-width': 1.5,
      }),
    );
    // The box behind the name: filled (CSS, .sensorMarkActive) while the sensor is on during a
    // run - only on the canvas, never in an export, which has no such style.
    const label = sensor.label.toLowerCase();
    const boxW = label.length * 7 + 6;
    const mark = createSvgEl('g', { class: 'sensorMark' });
    mark.dataset.label = sensor.label.toUpperCase();
    mark.appendChild(
      createSvgEl('rect', {
        x: x - boxW / 2,
        y: tipTop - 33,
        width: boxW,
        height: 15,
        rx: 2,
        fill: 'none',
        class: 'sensorMarkBg',
      }),
    );
    group.appendChild(mark);
    const text = createSvgEl('text', {
      x,
      y: tipTop - 22,
      'text-anchor': 'middle',
      'font-size': 11,
      class: 'sensorMarkLabel',
    });
    text.textContent = label;
    mark.appendChild(text);
  }
}

/** Marks each sensor on (yellow box behind its name) whose range the piston at `pos` is in -
 * while `running`; all off otherwise. */
export function showSensorMarkStates(
  group: SVGGElement,
  sensors: CylinderSensor[],
  pos: number,
  running: boolean,
): void {
  for (const mark of Array.from(group.querySelectorAll<SVGGElement>('.sensorMark'))) {
    const sensor = sensors.find((s) => s.label.toUpperCase() === mark.dataset.label);
    const on = running && sensor !== undefined && isInSensorRange(pos, sensor);
    mark.classList.toggle('sensorMarkActive', on);
  }
}
