import Bun from 'bun';
import { Client } from '@ws/client';
import type { WebSocketData } from '@ws/types';

// type t_ws = Bun.ServerWebSocket<{ data?: Client }>;



Bun.serve({
	fetch(req, server) {
		return new Response("FPS Server");
	},
	websocket: {
		data: {} as WebSocketData,
		open(ws) {
			ws.data.client = new Client(ws, Date.now());
		},
		message(ws, data) {
			if (!(data instanceof ArrayBuffer))
				return;
			if (ws.data.client && ws.data.client  instanceof Client)
				ws.data.client.onMessage(data);
		},
		close(ws) {
			if (ws.data.client && ws.data.client instanceof Client)
				ws.data.client.onClose();
		}
	}
});
