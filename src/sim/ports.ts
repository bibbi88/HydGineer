import type { ComponentId, PortKey } from '../core/types';

/** Globally unique key of one port: "<component id>:<port key>". */
export function portKey(id: ComponentId, port: PortKey): string {
  return `${id}:${port}`;
}
