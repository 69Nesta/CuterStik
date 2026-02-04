import { Entity } from '@game/entity'


class PlayerEntity extends Entity {
	id: string;
	constructor(id: string) {
		super();
		this.id = id;
	}

	update(deltaTime: number) {
		// Update player entity logic here
	}
}

export { PlayerEntity }