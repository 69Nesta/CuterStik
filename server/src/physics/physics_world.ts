import * as RAPIER from '@dimforge/rapier3d-compat'

await RAPIER.init()

class PhysicsWorld {
	public world: RAPIER.World
	public dynamicBodies: Array<RAPIER.RigidBody> = []

	constructor() {
		const gravity = { x: 0, y: -9.81, z: 0 }
		this.world = new RAPIER.World(gravity)
	}

	update(deltaTime: number) {
		this.world.timestep = Math.min(deltaTime, 0.1)
  		this.world.step()
	}

	register(body: RAPIER.RigidBody) {
		this.dynamicBodies.push(body)
	}

	remove(body: RAPIER.RigidBody) {
		const index = this.dynamicBodies.indexOf(body)
		if (index !== -1) {
			this.dynamicBodies.splice(index, 1)
		}
	}

	destroy() {
		// destroy physics world if needed
	}
}

export { PhysicsWorld }