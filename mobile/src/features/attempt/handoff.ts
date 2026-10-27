import type { Room } from "./types";

/** The room payload the start request already returned, handed to the room screen so it
 * does not ask again. In memory only; read once. */
const rooms = new Map<string, Room>();

export function handOff(room: Room) {
  rooms.set(room.attempt_id, room);
}

export function takeHandoff(id: string): Room | undefined {
  const room = rooms.get(id);
  rooms.delete(id);
  return room;
}
