import Bun from 'bun';
import { Client } from '@ws/client';
import type { WebSocketData } from '@ws/types';
import { set } from 'zod';


const server = Bun.serve({
	port: 8080,
	fetch(req, srv) {
		if (srv.upgrade(req, {
			headers: {'Sec-WebSocket-Protocol': 'fps-protocol'},
			data: {} as WebSocketData
		})) {
			return; // do not return a Response
		}
		return new Response("FPS Server");
	},
	websocket: {
		data: {} as WebSocketData,
		open(ws) {
			const client = new Client(ws, Bun.randomUUIDv7());
			ws.data.client = client
			ws.send(client.id)
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

export { server };