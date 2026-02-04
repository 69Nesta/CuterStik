
const socket = new WebSocket(`ws://localhost`);

socket.addEventListener('open', (event) => {
	console.log('Connected to the server');
});

socket.addEventListener('message', (event) => {
	console.log('Message from server ', event.data);
});

socket.addEventListener('close', (event) => {
	console.log('Disconnected from the server');
});

setTimeout(() => {
	socket.close();
}, 5000);