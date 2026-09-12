import type { LandmarkFrame } from '../../apps/web/src/features/sign/tracking/model.ts';
export type { LandmarkFrame } from '../../apps/web/src/features/sign/tracking/model.ts';

export class PreprocessingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'PreprocessingError'; this.code = code; }
}
export function requireValue(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new PreprocessingError(code, message);
}
function object(value: unknown): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_STRUCTURE', 'Expected object');
  return value as Record<string, unknown>;
}
function finiteTree(value: unknown): void {
  if (typeof value === 'number') requireValue(Number.isFinite(value), 'NONFINITE_INPUT', 'All input numbers must be finite');
  else if (Array.isArray(value)) for (const child of value) finiteTree(child);
  else if (value !== null && typeof value === 'object') for (const child of Object.values(value)) finiteTree(child);
}
function points(value: unknown, count: number): void {
  requireValue(Array.isArray(value) && value.length === count, 'INVALID_TOPOLOGY', 'Incorrect landmark count');
  for (const entry of value) {
    const point = object(entry);
    for (const axis of ['x', 'y', 'z']) requireValue(typeof point[axis] === 'number' && Number.isFinite(point[axis]), 'NONFINITE_INPUT', 'Coordinates must be finite numbers');
    if (point.visibility !== undefined) requireValue(typeof point.visibility === 'number' && Number.isFinite(point.visibility) && point.visibility >= 0 && point.visibility <= 1, 'INVALID_VISIBILITY', 'Invalid visibility');
  }
}
/** Runtime validation is needed by both artifact readers and future browser callers. */
export function validateSequence(values: readonly LandmarkFrame[]): void {
  requireValue(Array.isArray(values) && values.length > 0, 'EMPTY_SEQUENCE', 'At least one source observation required');
  let previousTime = -Infinity;
  let previousSequence = -Infinity;
  let geometry: string | undefined;
  let run: string | undefined;
  for (const value of values) {
    finiteTree(value);
    const frame = object(value);
    requireValue(frame.schemaVersion === 1 && frame.topology === 'human-553-v1', 'INCOMPATIBLE_SCHEMA', 'Unsupported LandmarkFrame schema');
    requireValue(typeof frame.trackingRunId === 'string' && frame.trackingRunId.length > 0 && (run === undefined || frame.trackingRunId === run), 'INVALID_RUN', 'A turn must belong to one tracking run');
    run = frame.trackingRunId;
    requireValue(typeof frame.timestampMs === 'number' && Number.isFinite(frame.timestampMs) && frame.timestampMs >= 0 && frame.timestampMs > previousTime, 'INVALID_TIMESTAMPS', 'Media timestamps must strictly increase');
    previousTime = frame.timestampMs;
    requireValue(typeof frame.sequence === 'number' && Number.isSafeInteger(frame.sequence) && frame.sequence > previousSequence && frame.sequence >= 1, 'INVALID_SEQUENCE', 'Sequence numbers must strictly increase');
    previousSequence = frame.sequence;
    const source = object(frame.source);
    requireValue(source.mirrored === false, 'MIRRORED_SOURCE', 'Unmirrored input required');
    for (const axis of ['width', 'height']) requireValue(typeof source[axis] === 'number' && Number.isSafeInteger(source[axis]) && source[axis] > 0, 'INVALID_GEOMETRY', 'Positive integer geometry required');
    const currentGeometry = `${source.width}x${source.height}`;
    requireValue(geometry === undefined || geometry === currentGeometry, 'CHANGED_GEOMETRY', 'Turn geometry must remain stable');
    geometry = currentGeometry;
    for (const [name, count] of [['pose', 33], ['leftHand', 21], ['rightHand', 21], ['face', 478]] as const) {
      if (frame[name] === null) continue;
      const component = object(frame[name]);
      points(component.image, count);
      if (component.world !== undefined) {
        requireValue(name !== 'face', 'INVALID_WORLD', 'Face has no world coordinates in this schema');
        const world = object(component.world);
        requireValue(world.space === 'pose-hips-meters', 'INVALID_WORLD', 'Unsupported world-coordinate space');
        points(world.points, count);
      }
    }
  }
}
