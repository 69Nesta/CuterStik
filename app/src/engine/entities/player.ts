import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d';
import { Engine } from '@engine/engine';
import type { Debug } from '@engine/debug';
import type { Physics } from '@engine/physics';
import type { GUI } from 'lil-gui';
import type { Input } from '@engine/input';

class Player {
	protected name: string;
	protected health: number;
	protected max_health: number;

	protected playerMesh: THREE.Mesh | undefined;
	protected playerBody: RAPIER.RigidBody | undefined;
	protected playerShape: RAPIER.ColliderDesc | undefined;
	protected playerCollider: RAPIER.Collider | undefined;

	protected engine: Engine;
    protected scene: THREE.Scene
    protected debug: Debug;
    protected physics: Physics;
    protected world: RAPIER.World;
    protected debugFolder: GUI | undefined;
    protected input: Input;

	SPEED = 5;
	JUMP_IMPULSE = 5;

	constructor(name: string, health: number, max_health: number = health) {
		this.engine = new Engine()
		this.scene = this.engine.scene
		this.debug = this.engine.debug
		this.physics = this.engine.physics
		this.world = this.physics.world
		this.input = this.engine.input

		this.name = name;
		this.health = health;
		this.max_health = max_health;

		if (this.debug.active) {
			this.debugFolder = this.debug.ui?.addFolder('Player')
		}

		this.inialize_character();
		// this.inialize_controls();

		// this.scene.add(this.playerMesh!);
		// this.physics.world.addRigidBody(this.playerBody!);
		// this.physics.register(this.playerMesh!, this.playerBody!);
	}

	inialize_character() {
		this.playerMesh = new THREE.Mesh(
			new THREE.CapsuleGeometry(0.5, 1.8, 4, 8),
			new THREE.MeshStandardMaterial({ color: '#c0ad24', wireframe: true })
		)
		this.playerMesh.position.set(0, 2, 0)
		this.scene.add(this.playerMesh)

		const capsuleBody = this.world.createRigidBody(
			RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 2, 0)
		)
		// lock rotation on the X and Z axis
		capsuleBody.lockRotations(true, false)
		const capsuleShape = RAPIER.ColliderDesc
								.capsule(0.5, 0.9)
								.setMass(1)
								.setRestitution(0)

		this.playerBody = capsuleBody
		this.playerShape = capsuleShape

		this.playerCollider = this.world.createCollider(capsuleShape, capsuleBody)
		this.physics.register(this.playerMesh, capsuleBody)

		if (this.debugFolder) {
			this.debugFolder
				.add(this, 'health' as keyof Player, 0, this.max_health)
				.name('Health')
				.listen()

			this.debugFolder
				.add(this.playerMesh!.material as THREE.MeshStandardMaterial, 'wireframe')
				.name('PlayerWireframe');

			this.debugFolder
				.addColor(this.playerMesh!.material as THREE.MeshStandardMaterial, 'color')
				.name('PlayerColor');
		}
	}


	update_player({ x, y, z }: { x: number; y: number; z: number }) {
		if (!this.playerBody) return


		// console.log('Updating player movement');
        if (Math.abs(x) > 0 || Math.abs(z) > 0 || Math.abs(y) > 0) {
            // eslint-disable-next-line no-console
            console.log('[Input] dir=', { x, y, z })
        }

        const currentVel = this.playerBody.linvel()
        const newVel = { x: x * this.SPEED, y: currentVel.y, z: z * this.SPEED }
        this.playerBody.setLinvel(newVel, true)

		// jump impulse
        if (y > 0 && Math.abs(currentVel.y) < 0.01) {
            this.playerBody.applyImpulse({ x: 0, y: this.JUMP_IMPULSE, z: 0 }, true)
        }
	}
	destroy() {
		if (this.playerMesh) {
			this.scene.remove(this.playerMesh);
			this.physics.remove(this.playerMesh);
		}
		this.debugFolder?.destroy();
	}
}

export { Player }