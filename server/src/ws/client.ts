import type { WebSocketData } from '@ws/types';

import Bun from 'bun';
import { decodeInput } from '@packets/codec';
import { InputSchema, type InputPacket } from '@packets/input';
import { PacketType } from '@packets/enums';
import { RoomManagerInstance } from '@ws/room_manager';
import type { PlayerId } from '@/types/player_id';


export class Client {
	readonly id: PlayerId;
	public ws: Bun.ServerWebSocket<WebSocketData>;

	// Input buffering
	private inputQueue: InputPacket[] = [];
	private lastSeq = 0;

	// Net stats
	ping = 0;
	lastHeard = Date.now();
	private roomId: string | null = null;

	constructor(ws: Bun.ServerWebSocket<WebSocketData>, id: PlayerId) {
		this.ws = ws;
		this.id = id;

		console.log(`Client connected: ${this.id}`);
	}

	response_login() {
		this.ws.send(JSON.stringify({
			type: 'welcome',
			id: this.id
		}));
	}

	// called by Bun on message
	onMessage(data: ArrayBuffer) {
		this.lastHeard = Date.now();

		const view = new DataView(data);
		const type = view.getUint8(0);

		switch (type) {
			case PacketType.INPUT:
				this.handleInput(data);
				break;
			case PacketType.PONG:
				const sentTime = view.getFloat64(1);
				this.ping = Date.now() - sentTime;
				break;
			case PacketType.LOGIN:
				this.login();
				break;
			default:
				// Unknown packet type
				console.warn(`Unknown packet type: ${type}`);
				break;
		}
	}

	login() {
		if (this.roomId) return;
		RoomManagerInstance
			.getRoom("default")
			?.addPlayer(this.id, this);
		this.roomId = "default";
	}

	logout() {
		if (!this.roomId) return;
		RoomManagerInstance
			.getRoom(this.roomId)
			?.removePlayer(this.id);
		this.roomId = null;
	}

	private handleInput(buffer: ArrayBuffer) {
		const raw = decodeInput(buffer);

		// Zod validation (anti-cheat + safety)
		const parsed = InputSchema.safeParse(raw);
		if (!parsed.success) return;

		const input = parsed.data;

		// Drop old / duplicated inputs
		if (input.seq <= this.lastSeq) return;
		this.lastSeq = input.seq;

		this.inputQueue.push(input);
	}

	// called from GameLoop
	consumeInputs(tick: number): InputPacket[] {
		const inputs = this.inputQueue;
		this.inputQueue = [];
		return inputs;
	}

	// send binary packet
	send(buffer: ArrayBuffer) {
		if (this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(buffer);
		}
	}

	onClose() {
		console.log(`Client disconnected: ${this.id}`);
		// cleanup handled by Room

		this.logout();
	}
}
