import { describe, expect, it } from 'vitest';
import { createPicture, MAX_PICTURE_WIDTH } from './picture';
import { pastePictureFrom } from '../interaction/pictures';

describe('picture', () => {
  it('starts as an empty frame asking for a picture', () => {
    const pic = createPicture(document.createElement('div'), 0, 0);
    expect(pic.snapshot().src).toBe('');
    expect(pic.el.textContent).toContain('choose a picture');
    expect(pic.el.querySelector('image')?.style.display).toBe('none');
  });

  it('shows its image at the width set, the height following its proportions', () => {
    const pic = createPicture(document.createElement('div'), 0, 0);
    pic.restore({ ...pic.snapshot(), src: 'data:image/png;base64,AAAA', width: 300, aspect: 0.5 });
    const image = pic.el.querySelector('image');
    expect(image?.getAttribute('href')).toBe('data:image/png;base64,AAAA');
    expect(image?.getAttribute('width')).toBe('300');
    expect(image?.getAttribute('height')).toBe('150');
    expect(pic.svgW).toBe(300);
    expect(pic.svgH).toBe(150);

    pic.restore({ ...pic.snapshot(), width: 99999 });
    expect(pic.snapshot().width).toBe(MAX_PICTURE_WIDTH);
  });

  it('a paste without a picture is left for the copied components', () => {
    expect(pastePictureFrom(null)).toBe(false);
  });
});
