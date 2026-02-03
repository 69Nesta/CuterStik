import { World } from '@game/world.js'
import { PhysicsWorld } from '@game/physics_world.js'
import type { PlayerId } from '@types/player_id.js'
import type { PlayerEntity } from '@entities/player_entity.js'

class Room {
	private id: string
	private world: World
	// private physics: PhysicsWorld
	private players: Map<PlayerId, PlayerEntity>

	tick(dt: number) {
		this.world.update(dt)
		this.physics.step(dt)
	}
}

export { Room }
