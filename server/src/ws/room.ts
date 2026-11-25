import { World } from '@game/world.ts'
import { type ClientId, type PlayerId } from '@/types/ids'
import { PlayerEntity } from '@game/player_entity.ts'
import type { Client } from '@ws/client'
import RAPIER from '@dimforge/rapier3d-compat'
import { encode_snapshot } from '@packets/codec'
import { Debugger } from '@/utils/debugger'

const debuggerInstance = new Debugger('Room', 'magenta')

class Room {
	private id: string
	private world: World
	private tick: number = 0
	// private physics: PhysicsWorld
	private players: Map<PlayerId, [Client, PlayerEntity]>
	private last_player_id: number;

	constructor(id: string) {
		this.id = id
		this.world = new World()
		this.players = new Map()
		this.last_player_id = 0;
	}

	add_player(client: Client) {
		debuggerInstance.log(`Adding player with client ID: ${client.id} to room ${this.id}`)
		const playerEntity = new PlayerEntity(this.world.world, new RAPIER.Vector3(0, 2, 0))

		this.players.set(this.create_id(), [client, playerEntity])

		this.world.add_entity(playerEntity)
	}

	remove_player(client_id: ClientId) {
		debuggerInstance.log(`Removing player with client ID: ${client_id}`)
		const player = this.players.entries().find(([id, [client, _]]) => client.id === client_id)
		// const entry = this.players.get(client_id)
		if (!player?.length) return

		const [id, [, playerEntity]] = player

		this.world.remove_entity(playerEntity)

		this.players.delete(id)
	}

	send_snapshot() {
		const snapshot = encode_snapshot(
			this.tick,
			Array.from(this.players.entries().map(([id, [_, entity]]) => ({
				id,
				position: entity.get_position(),
				rotation: entity.get_rotation(),
				velocity: entity.get_velocity()
			})))
		)
		for (const [client, _] of this.players.values()) {
			client.send_snapshot(snapshot)
		}
	}

	private create_id(): PlayerId {
		return this.last_player_id++ as PlayerId
	}

	update(dt: number) {
		this.world.update(dt)

		for (const [client, player] of this.players.values()) {
			player.update(client.consume_inputs())
			// client.update(dt)
		}
		this.send_snapshot()
		this.tick++
	}
}

export { Room }
