import * as RAPIER from '@dimforge/rapier3d-compat';
import type { Entity } from './entity';


export class World {
	world: RAPIER.World;

	constructor() {
		this.world = new RAPIER.World(new RAPIER.Vector3(0, -9.81, 0));

		this.setup_map()
	}

	add_entity(entity: Entity) {
		// skip for now 
	}

	remove_entity(entity: Entity) {
		entity.destroy()
	}

	setup_map() {
		const floorBody = this.world.createRigidBody(
			RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0)
		)
		const floorShape = RAPIER.ColliderDesc.cuboid(20, 0, 20).setRestitution(0)
		this.world.createCollider(floorShape, floorBody)

		const firstBox = this.createBox(
			new RAPIER.Vector3(0, 0.5, 7.5),
			new RAPIER.Vector3(10, 1, 5),
			'fixed'
		)

		const secondBox = this.createBox(
			new RAPIER.Vector3(-7.5, 1, 5),
			new RAPIER.Vector3(5, 2, 10),
			'fixed'
		)

		const thirdBox = this.createBox(
			new RAPIER.Vector3(-7.5, 1.5, -2.5),
			new RAPIER.Vector3(5, 3, 5),
			'fixed'
		)
	}

	createBox(position: RAPIER.Vector3, size: RAPIER.Vector3, bodyType: 'dynamic' | 'fixed' = 'dynamic') {
		const boxBody = this.world.createRigidBody(
			RAPIER.RigidBodyDesc[bodyType]().setTranslation(position.x, position.y, position.z)
		)
		const boxShape = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
			.setMass(1)
			.setRestitution(0)
		this.world.createCollider(boxShape, boxBody)

		return boxBody
	}

	update(dt: number) {
		this.world.timestep = dt
		this.world.step()
	}

	destroy() { }
}