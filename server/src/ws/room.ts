import { World } from '@game/world.ts'
import { type PlayerId } from '@/types/player_id.ts'
import { PlayerEntity } from '@game/player_entity.ts'
import { PhysicsWorld } from '@physics/physics_world'
import type { Client } from '@ws/client'

class Room {
	private id: string
	private world: World
	private physics: PhysicsWorld
	private players: Map<PlayerId, [Client, PlayerEntity]>

	constructor(id: string) {
		this.id = id
		this.physics = new PhysicsWorld()
		this.world = new World(this.physics.world)
		this.players = new Map()
	}

	addPlayer(playerId: PlayerId, client: Client) {
		const playerEntity = new PlayerEntity(playerId)

		this.players.set(playerId, [client, playerEntity])

		this.world.addEntity(playerEntity)
	}

	removePlayer(playerId: PlayerId) {
		const entry = this.players.get(playerId)
		if (!entry) return

		const [, playerEntity] = entry

		this.world.removeEntity(playerEntity)

		this.players.delete(playerId)
	}

	update(dt: number) {
		this.world.update(dt)

		for (const player of this.players.values()) {
			// player.update(dt)
		}
	}
}

export { Room }
