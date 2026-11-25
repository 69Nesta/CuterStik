import { RoomManagerInstance } from "@ws/room_manager";

class GameLoop {
	private intervalId: NodeJS.Timeout | null = null;
	public readonly tickRate: number = 60
	private readonly tickInterval: number = 1000 / this.tickRate;

	constructor() { }

	start() {
		if (this.intervalId) return;
		this.intervalId = setInterval(() => {
			this.update(this.tickInterval / 1000);
		}, this.tickInterval);
	}

	stop() {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	update(deltaTime: number) {
		// console.log(`[✅ GameLoop] Updating game world with deltaTime: ${deltaTime.toFixed(4)} seconds`);
		// Update game world, physics, entities, etc.
		RoomManagerInstance.update(deltaTime);
	}
}

const GameLoopInstance = new GameLoop();

export { GameLoop, GameLoopInstance };