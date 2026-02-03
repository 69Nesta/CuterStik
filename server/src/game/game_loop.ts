const TICK_RATE = 60;
const TICK_DT = 1000 / TICK_RATE;

const loop = setInterval(() => {
	for (const client of room.clients) {
		const inputs = client.consumeInputs(currentTick);

		for (const input of inputs) {
			world.applyInput(client.id, input);
		}
	}
}, TICK_DT);

export { loop };
