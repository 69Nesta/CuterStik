import type RAPIER from "@dimforge/rapier3d-compat";

class Entity {
	public collider: RAPIER.Collider;

	constructor(protected world: RAPIER.World, public body: RAPIER.RigidBody, collider_body: RAPIER.ColliderDesc) {
		this.collider = world.createCollider(collider_body, body);
	}

	destroy() {
		this.world.removeCollider(this.collider, false);
		this.world.removeRigidBody(this.body);
	}
}

export { Entity }