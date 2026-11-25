import { Debugger } from '@/utils/debugger';
import RAPIER from '@dimforge/rapier3d-compat';
import { Room } from '@ws/room';

const debuggerInstance = new Debugger('RoomManager', 'cyan');

class RoomManager {
	private rooms: Map<string, Room>;

	constructor() {
		this.rooms = new Map();
	}

	getRoom(roomId: string): Room | undefined {
		return this.rooms.get(roomId);
	}

	createRoom(roomId: string): Room {
		debuggerInstance.log(`Creating room with ID: ${roomId}`);
		const room = new Room(roomId);
		this.rooms.set(roomId, room);
		return room;
	}

	deleteRoom(roomId: string): void {
		debuggerInstance.log(`Deleting room with ID: ${roomId}`);
		this.rooms.delete(roomId);
	}

	update(deltaTime: number): void {
		for (const room of this.rooms.values()) {
			room.update(deltaTime);
			room.send_snapshot();
		}
	}
}

await  RAPIER.init();
debuggerInstance.log('Rapier Initialized');

const RoomManagerInstance = new RoomManager();
RoomManagerInstance.createRoom("default");

export { RoomManagerInstance, RoomManager };