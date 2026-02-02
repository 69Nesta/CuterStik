class Player {
	name: string;
	health: number;
	max_health: number;
	x: number;
	y: number;
	z: number;

	constructor(name: string, health: number, max_health: number = health) { 
		this.name = name;
		this.health = health;
		this.max_health = max_health;

		this.x = 0;
		this.y = 0;
		this.z = 0;
	}
}

export { Player }