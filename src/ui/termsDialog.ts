/**
 * The terms of use: what the software is (and isn't) for, the disclaimer of warranty and
 * liability, how data is handled, and the licence. Shown when the app opens until the user ticks
 * "Don't show this again" and agrees, and again whenever the terms change (TERMS_VERSION); always
 * readable from the inspector's Help section.
 */

/** Bump when the terms' substance changes, so everyone is asked to agree to the new ones. */
export const TERMS_VERSION = '1';
const STORAGE_KEY = 'hydgineer.termsAccepted';

interface TermsSection {
  heading: string;
  paragraphs: string[];
}

const COPYRIGHT = 'Copyright (c) 2026 bibbi88';

const MIT_LICENSE = [
  'Permission is hereby granted, free of charge, to any person obtaining a copy of this ' +
    'software and associated documentation files (the "Software"), to deal in the Software ' +
    'without restriction, including without limitation the rights to use, copy, modify, merge, ' +
    'publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons ' +
    'to whom the Software is furnished to do so, subject to the following conditions:',
  'The above copyright notice and this permission notice shall be included in all copies or ' +
    'substantial portions of the Software.',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, ' +
    'INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR ' +
    'PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE ' +
    'FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR ' +
    'OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER ' +
    'DEALINGS IN THE SOFTWARE.',
];

export const TERMS_SECTIONS: TermsSection[] = [
  {
    heading: 'Agreement',
    paragraphs: [
      'HydGineer is free software for learning and teaching hydraulics and ' +
        'electro-hydraulics. By using it you agree to these terms. If you do not agree, do not ' +
        'use the software - close this page.',
    ],
  },
  {
    heading: '1. For education only',
    paragraphs: [
      'The simulation is a simplified model. Switching, pressures, flows, forces, torques, ' +
        'speeds, power and efficiencies shown by the software are approximations and can differ ' +
        'considerably from real components and installations.',
      'The software is not a design, dimensioning, verification or safety tool. Do not rely ' +
        'on it, or on drawings made with it, as the basis for designing, building, ' +
        'commissioning, modifying, maintaining or troubleshooting real machinery or ' +
        'installations. Pressurised fluid (including fluid injection through the skin), energy ' +
        'stored in accumulators and trapped volumes, moving machinery and electrical equipment ' +
        'can cause serious injury and damage: real circuits must be designed, checked and ' +
        'installed by qualified persons in accordance with the applicable laws, standards ' +
        '(for example ISO 4413 and EN ISO 13849) and the manufacturers’ instructions.',
    ],
  },
  {
    heading: '2. No warranty',
    paragraphs: [
      'The software is provided "as is" and "as available", without warranty of any kind, ' +
        'express or implied, including but not limited to warranties of accuracy, ' +
        'merchantability, fitness for a particular purpose and non-infringement. There is no ' +
        'guarantee that it is free of errors, that its results, drawings or exports are correct ' +
        'or complete, or that it will remain available.',
    ],
  },
  {
    heading: '3. Limitation of liability',
    paragraphs: [
      'To the fullest extent permitted by law, the authors and copyright holders are not ' +
        'liable for any damages or losses of any kind - direct, indirect, incidental, special ' +
        'or consequential, including personal injury, damage to property, loss of data, loss ' +
        'of production or loss of profit - arising out of or in connection with the use of, or ' +
        'inability to use, the software or anything produced with it, whether in contract, ' +
        'tort or otherwise, even if advised of the possibility of such damages.',
    ],
  },
  {
    heading: '4. Your responsibility',
    paragraphs: [
      'You use the software at your own risk. You are responsible for checking any result ' +
        'before relying on it, and for how you use the software and the drawings, files and ' +
        'other material you create and share with it.',
    ],
  },
  {
    heading: '5. Your data',
    paragraphs: [
      'The software runs entirely in your web browser. Your projects and settings are kept ' +
        'only on your own device - in the browser’s storage and in the files you save - and ' +
        'are not sent to the authors or anyone else. Browser storage can be cleared, so keep ' +
        'your own copies of work you want to keep.',
    ],
  },
  {
    heading: '6. Your statutory rights',
    paragraphs: [
      'Nothing in these terms limits any rights you have that cannot be limited or excluded ' +
        'by law, such as mandatory consumer protection. Where the law does not allow a ' +
        'limitation above, it applies to the greatest extent the law allows.',
    ],
  },
  {
    heading: '7. Changes',
    paragraphs: [
      'These terms may be updated. When they change, you will be asked to agree to the new ' +
        'version.',
    ],
  },
  {
    heading: '8. Licence',
    paragraphs: [
      'HydGineer is open-source software released under the MIT License:',
      `MIT License - ${COPYRIGHT}`,
      ...MIT_LICENSE,
    ],
  },
];

function readAccepted(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeAccepted(): void {
  try {
    localStorage.setItem(STORAGE_KEY, TERMS_VERSION);
  } catch {
    // Storage unavailable (private window, blocked site data): the terms simply show again next
    // time, which is the safe side to fail on.
  }
}

/** Whether the terms should greet the user on opening the app. */
export function termsNeedAgreement(): boolean {
  return readAccepted() !== TERMS_VERSION;
}

/**
 * Opens the terms. `requireAgreement` is the start-up form: no close button, Escape or click
 * outside - only "I agree" (with an optional "Don't show this again") gets past it. Otherwise
 * it's for reading, from the Help section, and closes like any other dialog.
 */
export function openTermsDialog(options: { requireAgreement?: boolean } = {}): void {
  const requireAgreement = options.requireAgreement ?? false;

  const backdrop = document.createElement('div');
  backdrop.className = 'modalBackdrop';
  if (!requireAgreement) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });
  }

  const dialog = document.createElement('div');
  dialog.className = 'exportDialog termsDialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Terms of use');
  backdrop.appendChild(dialog);

  const header = document.createElement('div');
  header.className = 'exportDialogHeader';
  const title = document.createElement('h2');
  title.textContent = 'Terms of use';
  header.appendChild(title);
  if (!requireAgreement) {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'exportDialogClose';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => close());
    header.appendChild(closeBtn);
  }
  dialog.appendChild(header);

  const body = document.createElement('div');
  body.className = 'termsBody';
  for (const section of TERMS_SECTIONS) {
    const heading = document.createElement('div');
    heading.className = 'inspectorSectionHeading';
    heading.textContent = section.heading;
    body.appendChild(heading);
    for (const text of section.paragraphs) {
      const p = document.createElement('p');
      p.textContent = text;
      body.appendChild(p);
    }
  }
  dialog.appendChild(body);

  const footer = document.createElement('div');
  footer.className = 'termsFooter';
  if (requireAgreement) {
    const dontShow = document.createElement('label');
    dontShow.className = 'termsDontShow';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    dontShow.append(checkbox, document.createTextNode(' Don’t show this again'));
    const agreeBtn = document.createElement('button');
    agreeBtn.className = 'btn termsAgree';
    agreeBtn.type = 'button';
    agreeBtn.textContent = 'I agree';
    agreeBtn.addEventListener('click', () => {
      if (checkbox.checked) writeAccepted();
      close();
    });
    footer.append(dontShow, agreeBtn);
  } else {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => close());
    footer.appendChild(closeBtn);
  }
  dialog.appendChild(footer);

  function close(): void {
    backdrop.remove();
    window.removeEventListener('keydown', onKeydown);
  }
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && !requireAgreement) close();
  }
  window.addEventListener('keydown', onKeydown);

  document.body.appendChild(backdrop);
}
