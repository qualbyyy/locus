export function isCanvasZoomWheel(
  event: Pick<WheelEvent, 'ctrlKey' | 'metaKey'>
): boolean {
  return event.ctrlKey || event.metaKey;
}

export function getWheelZoomFactor(deltaY: number, wheelZoomSpeed: number): number {
  const safeDelta = Number.isFinite(deltaY) ? Math.max(-1000, Math.min(1000, deltaY)) : 0;
  const safeSpeed = Number.isFinite(wheelZoomSpeed)
    ? Math.max(0.1, Math.min(4, wheelZoomSpeed))
    : 1;
  return Math.exp(-safeDelta * 0.01 * safeSpeed);
}
