import { decode_join, encode_leave, decode_snapshot, encode_input } from '@shared/packets/codec';

class Client {
	public id: string | null = null ;
	private ws!: WebSocket;

	URL = `ws://${window.location.hostname}:${import.meta.env.VITE_WS_PORT}`;

	constructor()
	{
		console.log("WebSocket URL:", this.URL);
		this.initializate()
	}

	send(data: string) {
		this.ws.send(data);
	}

	onMessage(data: ArrayBuffer) {
		const view = new DataView(data);
		view.setUint8(0, 0); // Packet type: 0 for join
		
		// console.log("Received message:", new Uint8Array(data));
	}

	onClose() {
		this.id = null;
		// this.ws.close();
		// setTimeout(() => {
		// this.ws
		// 	// this.tryReconnect()
		// 	// this.login();
		// }, 1000);
	}

	tryReconnect() {
		if (this.ws.readyState === WebSocket.CLOSED) {
			console.log("Attempting to reconnect...");
			this.initializate();
		}
	}

	initializate()
	{
		this.ws = new WebSocket(this.URL);
		this.ws.onopen = () => {
			console.log("WebSocket connection established");
		};
		this.ws.onmessage = (event) => {
			if (event.data instanceof ArrayBuffer) {
				this.onMessage(event.data);
			} else {
				console.warn("Received non-ArrayBuffer message:", event.data);
			}
		};
		this.ws.onclose = () => {
			console.log("WebSocket connection closed");
			this.onClose();
		};
	}

	ping() {
		const buffer = new ArrayBuffer(9);
		const view = new DataView(buffer);
		view.setUint8(0, 1); // Packet type: 1 for ping
		view.setFloat64(1, Date.now()); // Timestamp
		this.ws.send(buffer);
	}

	destory() {
		this.ws.close();
	}
}

export { Client }
