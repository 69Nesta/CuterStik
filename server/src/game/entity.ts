import type RAPIER from "@dimforge/rapier3d-compat";

class Entity {
	public collider: RAPIER.Collider;

	constructor(protected world: RAPIER.World, public body: RAPIER.RigidBody, collider_body: RAPIER.ColliderDesc) {
		this.collider = world.createCollider(collider_body, body);
	}

	get_position(): { x: number, y: number, z: number } {
		const pos = this.body.translation();
		return { x: pos.x, y: pos.y, z: pos.z };
	}

	get_rotation(): { x: number, y: number, z: number, w: number } {
		const rot = this.body.rotation();
		return { x: rot.x, y: rot.y, z: rot.z, w: rot.w };
	}

	get_velocity(): { x: number, y: number, z: number } {
		const vel = this.body.linvel();
		return { x: vel.x, y: vel.y, z: vel.z };
	}

	destroy() {
		this.world.removeCollider(this.collider, false);
		this.world.removeRigidBody(this.body);
	}
}

export { Entity }