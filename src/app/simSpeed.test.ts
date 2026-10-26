import { afterEach, describe, expect, it } from 'vitest';
import { getSimSpeed, setSimSpeed, SIM_SPEEDS } from './simSpeed';
import { simulatedDt } from '../sim/loop';
import { MAX_DT } from '../sim/constants';
import { renderToolbar } from '../ui/toolbar';

afterEach(() => setSimSpeed(1));

describe('simulation speed', () => {
  it('runs in real time by default', () => {
    expect(getSimSpeed()).toBe(1);
    expect(simulatedDt(0.02)).toBeCloseTo(0.02, 12);
  });

  it('scales the simulated time per frame - slow motion and fast forward', () => {
    setSimSpeed(0.25);
    expect(simulatedDt(0.02)).toBeCloseTo(0.005, 12);
    setSimSpeed(4);
    expect(simulatedDt(0.02)).toBeCloseTo(0.08, 12);
  });

  it('never goes negative, when a frame timestamp comes out before the last one', () => {
    expect(simulatedDt(-0.004)).toBe(0);
    expect(simulatedDt(0)).toBe(0);
  });

  it('clamps a long frame before scaling it, so a stalled tab never jumps far ahead', () => {
    setSimSpeed(2);
    expect(simulatedDt(5)).toBeCloseTo(MAX_DT * 2, 12);
  });

  it('only takes one of its own steps, and remembers the choice', () => {
    setSimSpeed(3);
    expect(getSimSpeed()).toBe(1);
    setSimSpeed(0.5);
    expect(localStorage.getItem('hydgineer.simSpeed')).toBe('0.5');
  });
});

describe('simulation speed slider', () => {
  function slider(): { input: HTMLInputElement; label: () => string } {
    const container = document.createElement('div');
    renderToolbar(container);
    const input = container.querySelector<HTMLInputElement>('.simSpeedSlider') as HTMLInputElement;
    return {
      input,
      label: () => container.querySelector('.simSpeedValue')?.textContent ?? '',
    };
  }

  it('shows the current speed', () => {
    const { input, label } = slider();
    expect(label()).toBe('1×');
    expect(SIM_SPEEDS[Number(input.value)]).toBe(1);
  });

  it('sets the speed as it is dragged', () => {
    const { input, label } = slider();
    input.value = String(SIM_SPEEDS.indexOf(0.1));
    input.dispatchEvent(new Event('input'));
    expect(getSimSpeed()).toBe(0.1);
    expect(label()).toBe('0.1×');
  });

  it('goes back to real time on a double-click', () => {
    const { input, label } = slider();
    input.value = String(SIM_SPEEDS.indexOf(4));
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new MouseEvent('dblclick'));
    expect(getSimSpeed()).toBe(1);
    expect(label()).toBe('1×');
  });
});
