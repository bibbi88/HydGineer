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
      'Drag a check valve, throttle valve, one-way flow control or flow control valve onto an ' +
        'existing wire (it highlights green when close enough) to splice it in, instead of ' +
        'dropping it unconnected on top.',
      'The Examples menu in the toolbar loads ready-made circuits to start from.',
      'Right-click a component for Rotate, Copy, and Delete.',
      'Right-click a hydraulic port to put a tank symbol on it - the quick way to draw a ' +
        'return line, e.g. on a valve’s T port.',
      'Arrow keys nudge the selected component; hold Shift to move a full grid step further.',
      'Delete or Backspace removes the current selection.',
      'Ctrl+C / Ctrl+V copies and pastes the selection.',
      'Ctrl+Z undoes, Ctrl+R redoes.',
      'Escape cancels a wire you’re in the middle of drawing, or clears the current selection ' +
        'if nothing is being drawn.',
    ],
  },
  {
    heading: 'How the hydraulics are calculated',
    tips: [
      'Every frame the whole circuit is solved for its pressures and flows: oil is conserved at ' +
        'every line (what flows in flows out), every valve path follows its own characteristic, ' +
        'and every cylinder and motor is in force/torque balance with its load.',
      'Units: pressure in bar (gauge, tank = 0), flow in L/min. F = p·A, v = Q/A for a cylinder; ' +
        'n = Q/V and T = Δp·V/2π for a motor.',
      'Directional valve paths, check valves and throttles are orifices: Δp grows with the ' +
        'square of the flow. A valve’s nominal flow is the flow per path at a 5 bar drop; a ' +
        'throttle is a sharp-edged orifice of the set diameter (Cd 0.62, oil 870 kg/m³).',
      'The pump delivers displacement × speed, less leakage that grows with pressure (the ' +
        'volumetric efficiency is reached at the rated pressure). With nowhere for the oil to ' +
        'go and no relief valve, the pressure runs away - a warning shows.',
      'A relief valve stays shut below its cracking pressure, then opens just far enough to ' +
        'pass the surplus flow (10 L/min per bar of override). The flow it dumps is heat.',
      'Cylinders: the load force opposes extension (enter it negative for a load that pulls the ' +
        'rod out); seal friction has to be overcome before the piston moves at all.',
      'The oil is very slightly compressible (bulk modulus 10 000 bar), so a closed-off volume ' +
        'keeps its pressure, and pressure takes a moment to build up. Steady values are exact.',
      'Hover over a wire or a port while simulating for its exact pressure and flow. The longest ' +
        'wire of each line shows them as a label; pressure lines are red (darker = higher), ' +
        'return lines blue, and the moving dashes show which way the oil flows.',
      'Flow dividers split one inlet flow between outlets A and B. The spool type holds the ' +
        'split with a pressure-compensating sleeve that throttles the lighter-loaded side, so ' +
        'the inlet runs at the higher load pressure and the throttling becomes heat. The rotary ' +
        '(gear) type splits by displacement on a common shaft: the inlet sees the mean of the ' +
        'outlet pressures, and one outlet can rise above the inlet pressure (intensification). ' +
        'With either type, blocking one outlet stops the other, and both combine flow in reverse.',
      'Accumulator: holds no oil below its gas pre-charge; above it the nitrogen is ' +
        'compressed by the gas law, so it stores oil under pressure and gives it back when the ' +
        'line pressure falls - far more flow than the pump, for a short time.',
      'Counterbalance valve: fit it between the directional valve (V) and the side of the ' +
        'cylinder that carries the load (L), with its pilot X from the other cylinder line. It ' +
        'lets oil in freely, holds the load, and lets it down only while the pump drives it ' +
        'down - so the load can never run away.',
      'Pump: set Displacement to "Variable, pressure compensated" and the pump swivels back ' +
        'near its compensator setting, delivering only what the circuit takes - compare the ' +
        'power with a fixed pump dumping over its relief valve. Its Motor signal "!S1" runs it ' +
        'while signal S1 is off, e.g. until a pressure switch says the accumulator is charged.',
      'Cylinders: give the moving mass (kg) to include inertia. The piston then accelerates ' +
        'and decelerates by F = m·a against the springy oil, and stopping it suddenly shows the ' +
        'pressure peak it causes ("peak" in its readout). Each frame is solved in steps of 2 ms.',
      'Load sensing: wire each load-sensing valve’s LS port to the LS pump’s LS port (with ' +
        'two sections, through a shuttle valve, which passes on the higher signal). The pump ' +
        'then holds its outlet at the highest load pressure plus its margin, so the flow follows ' +
        'the lever and not the load, and the pump only makes the pressure that’s needed. In ' +
        'neutral the LS line is vented and the pump idles at standby pressure.',
      'Load-sensing valve lever: drag the slider beside the valve while simulating - left = ' +
        'P→A, right = P→B, middle = closed (double-click it to centre). With several sections, ' +
        'tick "Section pressure compensator" so a lightly loaded section doesn’t take all the oil.',
      'Flow dividers, pumps and directional valves can be switched type in place: pick another type ' +
        'in the inspector, or drag the other type from the library onto it (it outlines green). ' +
        'Wires, position and rotation are kept.',
      'Hand-lever valves are switched by clicking the left or right half of the symbol while the ' +
        'simulation runs; click the same side again to return to centre.',
    ],
  },
  {
    heading: 'Electro-hydraulics',
    tips: [
      'The Electrical group holds a +24 V and a 0 V supply, contacts, a push button, coils and ' +
        'a lamp. Electrical terminals (dark blue) only connect to other electrical terminals.',
      'A coil publishes its name (e.g. Y1, K1) while energized. A solenoid valve with the same ' +
        'name shifts, and a contact whose "Signal" is that name (a relay contact) closes.',
      'Each solenoid valve you place takes the next free Y name, so two valves never start out ' +
        'sharing a coil. If you rename one onto another the labels turn red - allowed, since a ' +
        'real circuit may drive several valves off one output, but usually a slip.',
      'Set a contact’s Signal to a cylinder sensor label (e.g. A1) to use it as a position sensor, ' +
        'or to a pressure switch’s name (e.g. S1) to switch on pressure.',
      'A pump can be switched by a coil: put its name (e.g. K1) in the pump’s "Motor signal".',
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
