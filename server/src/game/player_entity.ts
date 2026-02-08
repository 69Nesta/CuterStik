import RAPIER from '@dimforge/rapier3d-compat'
import { Entity } from '@game/entity'


class PlayerEntity extends Entity {
	constructor(world: RAPIER.World, spawn_point: RAPIER.Vector3) {
		const body = world.createRigidBody(
			RAPIER.RigidBodyDesc
				.dynamic()
				.setTranslation(spawn_point.x, spawn_point.y, spawn_point.z)
		)
		body.lockRotations(true, false)

		const collider = RAPIER.ColliderDesc
			.cuboid(0.5, 1, 0.5)
			.setFriction(0.5)
			.setRestitution(0.1)

		super(
			world,
			body,
			collider
		)
	}
}

export { PlayerEntity }