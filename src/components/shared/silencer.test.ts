import { describe, expect, it } from 'vitest';
import { createValve52 } from '../valve52';

function compLayer(): HTMLElement {
  return document.createElement('div');
}

describe('a silenced port hides its connector dot and stops accepting clicks', () => {
  it('valve52: port 3 starts silenced by default (conventional fit), and toggling it flips both', () => {
    const valve = createValve52(compLayer(), 0, 0);
    const port3 = valve.ports['3'];
    if (!port3) throw new Error('expected port 3 to exist');
    expect(port3.el.classList.contains('portSilenced')).toBe(true);
    expect(port3.el.style.pointerEvents).toBe('none');

    valve.restore({ ...valve.snapshot(), silencer3: 'none' });
    expect(port3.el.classList.contains('portSilenced')).toBe(false);
    expect(port3.el.style.pointerEvents).not.toBe('none');

    valve.restore({ ...valve.snapshot(), silencer3: 'silencer' });
    expect(port3.el.classList.contains('portSilenced')).toBe(true);
    expect(port3.el.style.pointerEvents).toBe('none');

    // Port 5 also defaults to silenced, independently of port 3's own state throughout.
    const port5 = valve.ports['5'];
    if (!port5) throw new Error('expected port 5 to exist');
    expect(port5.el.classList.contains('portSilenced')).toBe(true);
  });
});
