class Client {
	public id: string | null;
	private ws: WebSocket;

	constructor()
	{
		console.log("WebSocket URL:", `ws://${window.location.hostname}:${import.meta.env.VITE_WS_PORT}`);
		this.ws = new WebSocket(`ws://${window.location.hostname}:${import.meta.env.VITE_WS_PORT}`);
		this.id = null;
		// this.id = crypto.randomUUID();
	}

	send(data: string) {
		this.ws.send(data);
	}

	onMessage(callback: (data: MessageEvent) => void) {
		this.ws.addEventListener('message', callback);
	}
}

export { Client }
