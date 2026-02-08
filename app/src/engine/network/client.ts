class Client {
	public id: string | null;
	private ws: WebSocket;

	constructor()
	{
		console.log("WebSocket URL:", `ws://${window.location.hostname}:${import.meta.env.VITE_WS_PORT}`);
		this.ws = new WebSocket(`ws://${window.location.hostname}:${import.meta.env.VITE_WS_PORT}`);
		this.id = null;
		// this.id = crypto.randomUUID();

		setTimeout(() => {
			this.login();
		}, 1000);
	}

	send(data: string) {
		this.ws.send(data);
	}

	onMessage(callback: (data: MessageEvent) => void) {
		this.ws.addEventListener('message', callback);
	}

	login() {
		this.ws.send(JSON.stringify({
			type: 'login',
		}));
	}

	logout() {
		this.ws.send(JSON.stringify({
			type: 'logout',
		}));
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
