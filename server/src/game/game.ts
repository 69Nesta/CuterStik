import type { Server } from '@server/server'
import type { Client } from '@ws/client'
import { PlayerEntity } from '@game/player_entity'
import { Vector3 } from '@dimforge/rapier3d-compat'
import { World } from '@game/world'

class Game {
	public world: World
	public phase: 'waiting' | 'playing' | 'ended' = 'playing'
	public players: Map<Client, PlayerEntity> = new Map()

	constructor(public server: Server) {
		this.world = new World()
	}

	add_player(client: Client) {
		const player = new PlayerEntity(this.world.world, new Vector3(0, 2, 0))
		this.players.set(client, player)
		this.world.add_entity(player)
	}

	remove_player(client: Client) {
		this.world.remove_entity(this.players.get(client)!)
		this.players.delete(client)
	}

	tick(elapsed_time: number) {
		this.world.update(elapsed_time)
		// Broadcast game state to clients (not implemented here)
	}
}

export { Game }