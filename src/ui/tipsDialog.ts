interface TipSection {
  heading: string;
  tips: string[];
}

// Everything a hint or comment elsewhere in the UI already says, gathered into one place - plus
// the keyboard/mouse interactions (viewport.ts's pan/zoom, interaction/keyboard.ts's shortcuts,
// componentContextMenu.ts's right-click menu) that aren't shown anywhere in the app itself.
const TIP_SECTIONS: TipSection[] = [
  {
    heading: 'The toolbar',
    tips: [
      'The toolbar across the top is grouped: the project (name, save, load, export), the ' +
        'simulation (play/stop, pause, step, undo, redo), the view (zoom out/in, fit to window, ' +
        'zoom to selection) and arranging the selection (rotate, flip).',
      'Fit to window frames the whole drawing - the components plus the page frame, when one is ' +
        'switched on.',
      'Zoom to selection frames just what you have selected. The percentage between the two ' +
        'magnifiers is a button too: it resets the zoom to 100%.',
      'The grid button toggles the grid and snap-to-grid together, and stays lit while they ' +
        'are on. It is a personal preference, remembered across projects rather than saved ' +
        'into one.',
      'Rotate and flip apply to everything currently selected. Flip is offered for cylinders ' +
        'only - mirroring any other symbol would print its port labels backwards.',
    ],
  },
  {
    heading: 'Canvas navigation',
    tips: [
      'Scroll to zoom in/out.',
      'Middle-click drag, or Alt + drag with either outer button, to pan.',
      'Drag with the left button on empty canvas to rubber-band select; hold Shift to add to ' +
        'the current selection rather than replace it.',
      'Right-click empty canvas → Zoom to fit, the same as the toolbar button.',
      'Right-click empty canvas → Paste, to drop a copy exactly where you clicked.',
    ],
  },
  {
    heading: 'Placing & editing',
    tips: [
      'Drag a component from the sidebar onto the canvas, or click it to add at the view center. ' +
        'Placing is an edit, so the library greys out while the simulation is running - stop it ' +
        'first.',
      'Drag a check valve, throttle valve, one-way flow control valve, quick exhaust valve, ' +
        'pressure reducing valve or 3/2 valve onto an existing wire (it highlights green when ' +
        'close enough) to splice it in, instead of dropping it unconnected on top. A 3/2 valve ' +
        'turns to put port 1 toward the supply and port 2 toward the consumer.',
      'Right-click a component for Rotate, Copy, and Delete.',
      'Right-click a port to add a pressure source to it, or a silencer on an exhaust port ' +
        '(right-click the silencer itself to change it again).',
      'Arrow keys nudge the selected component; hold Shift to move a full grid step further.',
      'Delete or Backspace removes the current selection.',
      'Ctrl+C / Ctrl+V copies and pastes the selection.',
      'Ctrl+Z undoes, Ctrl+R redoes.',
      'Escape cancels a wire you’re in the middle of drawing, or clears the current selection ' +
        'if nothing is being drawn.',
    ],
  },
  {
    heading: 'Valves & flow control',
    tips: [
      'Every 3/2 valve - push button, limit switch, air-piloted and time delay - can be ' +
        'switched between normally closed and normally open in the inspector. The two cells ' +
        'trade places, so at rest it either blocks the supply or passes 1 → 2; the actuator ' +
        'itself still works the same way round.',
      'A 3/2 valve can be converted between push button, limit switch and air-piloted ' +
        'actuation, and a 5/2 or 5/3 between pneumatic and solenoid, from the inspector’s ' +
        'Control mode / Operation dropdown. Wires on ports the new variant also has carry over; ' +
        'a wire on a port it doesn’t have is dropped.',
      'Exhaust ports come with a silencer fitted by default - the inspector can take it off.',
      'The pressure reducing valve caps everything downstream of it at its set pressure: port ' +
        'and wire readouts show the reduced figure, and a cylinder behind one develops ' +
        'proportionally less force. It only reduces - set it at or above supply and the line ' +
        'stays at supply pressure.',
    ],
  },
  {
    heading: 'Electro-pneumatics',
    tips: [
      'The Electrical group holds a +24 V and a 0 V supply, contacts, a push button, coils and ' +
        'a lamp. Electrical terminals (dark blue) only connect to other electrical terminals.',
      'A coil publishes its name (e.g. Y1, K1) while energized. A solenoid valve with the same ' +
        'name shifts, and a contact whose "Signal" is that name (a relay contact) closes.',
      'Each solenoid valve you place takes the next free Y name, so two valves never start out ' +
        'sharing a coil. If you rename one onto another the labels turn red - allowed, since a ' +
        'real circuit may drive several valves off one output, but usually a slip.',
      'Set a contact’s Signal to a cylinder sensor label (e.g. A1) to use it as a position sensor.',
      'The PLC has inputs I0.0-I0.3 (true while wired to +24 V), outputs Q0.0-Q0.3 (drive their ' +
        'terminal to +24 V when true) and L+/M supply terminals. Double-click the PLC to write ' +
        'its logic as a function block diagram: place signal, AND/OR/XOR/NOT, timer/counter/' +
        'latch and coil blocks, then drag from a block’s output dot to another’s input ' +
        'dot to wire them.',
      'The inspector’s "Program" field is a read-only preview of the diagram’s ' +
        'generated logic (e.g. "Q0.0 = (I0.0 | Q0.0) & !I0.1" for a start/stop self-hold) - edit ' +
        'it by double-clicking the PLC, not by typing there.',
      'Wires that are connected to +24 V during a run turn amber. Hold the mouse on an ' +
        'electric push button to press it (Ctrl+click latches).',
    ],
  },
  {
    heading: 'Project info & the page frame',
    tips: [
      'The project name sits in the toolbar. Date, author, checked by and company live in the ' +
        'inspector’s "Project info" section (visible with nothing selected), and all of them ' +
        'appear on the sheet’s title block.',
      'The page frame (None/A4/A3) draws a sheet outline with that title block, centered on the ' +
        'current diagram when picked - a visual guide only, not a hard boundary.',
    ],
  },
  {
    heading: 'Exporting',
    tips: [
      'Export (the toolbar’s download icon) opens a dialog with a live preview and a choice of ' +
        'what to crop to: Everything, the page frame, or whatever’s currently in view.',
      'To export just part of a diagram, pan/zoom to that region first, then pick "Current view".',
    ],
  },
];

export function openTipsDialog(): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'modalBackdrop';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  const dialog = document.createElement('div');
  dialog.className = 'exportDialog tipsDialog';
  backdrop.appendChild(dialog);

  const header = document.createElement('div');
  header.className = 'exportDialogHeader';
  const title = document.createElement('h2');
  title.textContent = 'Tips';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'exportDialogClose';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.addEventListener('click', () => close());
  header.append(title, closeBtn);
  dialog.appendChild(header);

  for (const section of TIP_SECTIONS) {
    const heading = document.createElement('div');
    heading.className = 'inspectorSectionHeading';
    heading.textContent = section.heading;
    dialog.appendChild(heading);

    const list = document.createElement('ul');
    list.className = 'tipsList';
    for (const tip of section.tips) {
      const item = document.createElement('li');
      item.textContent = tip;
      list.appendChild(item);
    }
    dialog.appendChild(list);
  }

  function close(): void {
    backdrop.remove();
    window.removeEventListener('keydown', onKeydown);
  }
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') close();
  }
  window.addEventListener('keydown', onKeydown);

  document.body.appendChild(backdrop);
}
