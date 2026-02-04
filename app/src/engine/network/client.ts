class Client {
	readonly id: string;
	private ws: WebSocket;

	constructor()
	{
		console.log("WebSocket URL:", `ws://${window.location.hostname}:${import.meta.env.VITE_WS_PORT}`);
		this.ws = new WebSocket(`ws://${window.location.hostname}:${import.meta.env.VITE_WS_PORT}`);
		
		this.ws.addEventListener('open', () => {
			console.log('WebSocket connection established');
		});
		
		this.ws.addEventListener('close', () => {
			console.log('WebSocket connection closed');
		});

		this.onMessage((event) => {
			const message = event.data;
			console.log('Message from server:', message);
			// if (message.type === 'id') {
			// 	this.id = message.id;
			// 	console.log('Client ID received:', this.id);
			// }
		});
	}

	send(data: string) {
		this.ws.send(data);
	}

	onMessage(callback: (data: MessageEvent) => void) {
		this.ws.addEventListener('message', callback);
	}
}

export { Client }
