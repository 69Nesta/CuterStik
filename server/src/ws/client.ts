import type { WebSocketData } from '@ws/types';

import Bun from 'bun';
import { decode_input } from '../../../shared/src/packets/codec';
import { InputSchema, type InputPacket } from '@shared/packets/input';
import { PacketSize, PacketType } from '../../../shared/src/packets/enums';
import { RoomManagerInstance } from '@ws/room_manager';
import type { ClientId } from '@/types/ids';


export class Client {
	readonly id: ClientId;
	public ws: Bun.ServerWebSocket<WebSocketData>;

	// Input buffering
	private input_queue: InputPacket[] = [];
	private last_seq = 0;

	// Net stats
	ping = 0;
	last_heard = Date.now();
	private room_id: string | null = null;

	constructor(ws: Bun.ServerWebSocket<WebSocketData>, id: ClientId) {
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
	on_message(data: ArrayBuffer) {
		this.last_heard = Date.now();

		const view = new DataView(data);
		const type = view.getUint8(0);

		switch (type) {
			case PacketType.INPUT:
				this.handle_input(data);
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

	send_snapshot(view: DataView) {
		const lastInputSeqIndex = PacketSize.TYPE + PacketSize.SERVER_TICK + PacketSize.ENTITIES_COUNT;
		view.setUint32(lastInputSeqIndex, this.last_seq);

		this.send(view.buffer as ArrayBuffer);
	}

	login() {
		if (this.room_id) return;
		RoomManagerInstance
			.getRoom("default")
			?.add_player(this);
		this.room_id = "default";
	}

	logout() {
		if (!this.room_id) return;
		RoomManagerInstance
			.getRoom(this.room_id)
			?.remove_player(this.id);
		this.room_id = null;
	}

	private handle_input(buffer: ArrayBuffer) {
		const raw = decode_input(buffer);

		// Zod validation (anti-cheat + safety)
		const parsed = InputSchema.safeParse(raw);
		if (!parsed.success) return;

		const input = parsed.data;

		// Drop old / duplicated inputs
		if (input.seq <= this.last_seq) return;
		this.last_seq = input.seq;

		this.input_queue.push(input);
	}

	// called from GameLoop
	consume_inputs(): InputPacket[] {
		const inputs = this.input_queue;
		this.input_queue = [];
		return inputs;
	}

	// send binary packet
	send(buffer: ArrayBuffer) {
		if (this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(buffer);
		}
	}

	on_close() {
		console.log(`Client disconnected: ${this.id}`);
		// cleanup handled by Room

		this.logout();
	}
}
