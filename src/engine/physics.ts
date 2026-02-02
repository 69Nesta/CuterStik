import RAPIER from '@dimforge/rapier3d-compat'

class Physics {
	static instance: Physics
	world!: RAPIER.World

	constructor() {
		if (Physics.instance) {
			return Physics.instance
		}
		Physics.instance = this

		const gravity = { x: 0.0, y: -9.81, z: 0.0 }
		this.world = new RAPIER.World(gravity)
	}
}

export { Physics }