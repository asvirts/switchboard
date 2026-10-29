export interface ManagedMarkers {
  start: string;
  end: string;
  malformedMessage: string;
}

export function managedBlockBounds(content: string, markers: ManagedMarkers): { from: number; to: number } | null {
  const starts = content.split(markers.start).length - 1;
  const ends = content.split(markers.end).length - 1;
  const from = content.indexOf(markers.start);
  const end = content.indexOf(markers.end);
  if (starts !== ends || starts > 1 || (starts && end < from)) throw new Error(markers.malformedMessage);
  return starts ? { from, to: end + markers.end.length } : null;
}

export function updateManagedBlock(content: string, block: string | null, markers: ManagedMarkers): string {
  const section = managedBlockBounds(content, markers);
  if (section) return content.slice(0, section.from) + (block ?? '') + content.slice(section.to);
  if (block === null) return content;
  return content + (content && !content.endsWith('\n') ? '\n' : '') + (content ? '\n' : '') + block + '\n';
}
