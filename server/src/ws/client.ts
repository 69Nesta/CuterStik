import type { WebSocketData } from '@ws/types';

import Bun from 'bun';
import { decodeInput } from '@packets/codec';
import { InputSchema, type InputPacket } from '@packets/input';
import { PacketType } from '@packets/enums';



export class Client {
	readonly id: number;
	private ws: Bun.ServerWebSocket<WebSocketData>;

	// Input buffering
	private inputQueue: InputPacket[] = [];
	private lastSeq = 0;

	// Net stats
	ping = 0;
	lastHeard = Date.now();

	constructor(ws: Bun.ServerWebSocket<WebSocketData>, id: number) {
		this.ws = ws;
		this.id = id;
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
		}
	}

	// input handling
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
		// cleanup handled by Room
	}
}
