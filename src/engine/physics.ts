import RAPIER from '@dimforge/rapier3d'
import { Mesh } from 'three'


class Physics {
	public world: RAPIER.World
	public dynamicBodies: Map<Mesh, RAPIER.RigidBody> = new Map()

	constructor() {
		const gravity = { x: 0, y: -9.81, z: 0 }
		this.world = new RAPIER.World(gravity)
	}

	update(deltaTime: number) {
		this.world.timestep = Math.min(deltaTime, 0.1)
  		this.world.step()

		for (const [mesh, body] of this.dynamicBodies) {
			const position = body.translation()
			const rotation = body.rotation()

			mesh.position.set(position.x, position.y, position.z)
			mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
		}
	}

	register(mesh: Mesh, body: RAPIER.RigidBody) {
		this.dynamicBodies.set(mesh, body)
	}

	remove(mesh: Mesh) {
		this.dynamicBodies.delete(mesh)
	}

	destroy() {
		// destroy physics world if needed
	}
}

export { Physics }