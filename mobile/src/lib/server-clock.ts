/** The server's clock as seen from this phone. A phone's clock can be minutes (or days)
 * off; exam windows and countdowns must follow the server, which is the only clock the
 * exam engine trusts. Each response carrying `server_time` updates the offset. */
let offsetMs = 0;

export function syncServerClock(serverTime: string, receivedAt: number = Date.now()): void {
  const server = Date.parse(serverTime);
  if (!Number.isNaN(server)) offsetMs = server - receivedAt;
}

/** Current server time in ms (phone time + the last measured offset). */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

export function resetServerClock(): void {
  offsetMs = 0;
}
