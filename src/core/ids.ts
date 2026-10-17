let nextId = 1;

export function uid(): number {
  return nextId++;
}

export function resetIdCounter(startAt = 1): void {
  nextId = startAt;
}
