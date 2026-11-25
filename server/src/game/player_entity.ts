import RAPIER from '@dimforge/rapier3d-compat'
import { Entity } from '@game/entity'
// import type { InputPacket } from '@packets/types'
import type { InputPacket } from '../../../shared/src/packets/types'


class PlayerEntity extends Entity {
	SPEED = 5;
	JUMP_IMPULSE = 5;

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

	update(inputs: InputPacket[]) {
		inputs.forEach(input => {
			this.update_player({x: input.moveX, y: input.moveY, z: input.moveZ })
		})
	}

	update_player({ x, y, z }: { x: number; y: number; z: number }) {
		if (!this.body) return


		// console.log('Updating player movement');
        if (Math.abs(x) > 0 || Math.abs(z) > 0 || Math.abs(y) > 0) {
            // eslint-disable-next-line no-console
            console.log('[Input] dir=', { x, y, z })
        }

        const currentVel = this.body.linvel()
        const newVel = { x: x * this.SPEED, y: currentVel.y, z: z * this.SPEED }

        this.body.setLinvel(newVel, true)

		// jump impulse
        if (y > 0 && Math.abs(currentVel.y) < 0.01) {
            this.body.applyImpulse({ x: 0, y: this.JUMP_IMPULSE, z: 0 }, true)
        }
	}
}

export { PlayerEntity }