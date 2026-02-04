import { Room } from '@ws/room';


class RoomManager {
	private rooms: Map<string, Room>;

	constructor() {
		this.rooms = new Map();
	}

	getRoom(roomId: string): Room | undefined {
		return this.rooms.get(roomId);
	}

	createRoom(roomId: string): Room {
		const room = new Room(roomId);
		this.rooms.set(roomId, room);
		return room;
	}

	deleteRoom(roomId: string): void {
		this.rooms.delete(roomId);
	}

	update(deltaTime: number): void {
		for (const room of this.rooms.values()) {
			room.update(deltaTime);
		}
	}
}

const RoomManagerInstance = new RoomManager();
RoomManagerInstance.createRoom("default");

export { RoomManagerInstance, RoomManager };