import * as THREE from 'three';
import { Engine } from '@engine/engine.ts';
import { Camera } from '@engine/render/camera.ts';
import type { Debug } from '@engine/debug.ts';
import * as RAPIER from '@dimforge/rapier3d';

import { type GUI } from 'lil-gui';
import type { Physics } from './physics';
import { Input } from '@engine/input.ts';

export class World {
    engine: Engine;
    scene: THREE.Scene
    camera: Camera;
    debug: Debug;
    physics: Physics;
    world: RAPIER.World;
    debugFolder: GUI | undefined;
    input: Input;

    map: Map<string, THREE.Mesh> = new Map();

    // player references for input-driven movement
    playerMesh: THREE.Mesh | undefined;
    playerBody: RAPIER.RigidBody | undefined;
    // private _tickHandler?: () => void;

    constructor() {
        this.engine = new Engine()
        this.scene = this.engine.scene
        this.camera = this.engine.camera
        this.debug = this.engine.debug
        this.physics = this.engine.physics
        this.world = this.physics.world
        this.input = this.engine.input


        if (this.debug.active) {
            this.debugFolder = this.debug.ui?.addFolder('environment');
        }

        this.setup_environement()
        this.setup_map()
        // this.test_box()

        // this._tickHandler = this.tick.bind(this)
        // this.engine.time.on('tick', this._tickHandler)
    }


	setup_environement() {
		const skyColor = 0xb1e1ff;	
		const groundColor = 0xb97a20;
		const intensity = 3;
		const light = new THREE.HemisphereLight(skyColor, groundColor, intensity);
		this.scene.add(light);
	}

    setup_map() {
        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(20, 20),
            new THREE.MeshStandardMaterial({ color: '#777777', wireframe: true })
        )
        floor.rotation.x = - Math.PI / 2
        floor.receiveShadow = true
        this.scene.add(floor)
        this.map.set('floor', floor)

        const floorBody = this.world.createRigidBody(
            RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0)
        )
        const floorShape = RAPIER.ColliderDesc.cuboid(10, 0, 10).setRestitution(0)
        this.world.createCollider(floorShape, floorBody)

        const rampGeometry = new THREE.BufferGeometry();
		const rampAttriutes = new Float32Array( [
			-5.0, 0.0, -2.0,
			 5.0, 0.0, -2.0,
			 5.0, 3.0,  5.0,
			-5.0, 0.0, -2.0,
			 5.0, 3.0,  5.0,
			-5.0, 3.0,  5.0,
		] );
		rampGeometry.setAttribute('position', new THREE.BufferAttribute(rampAttriutes, 3));
		rampGeometry.computeVertexNormals(); 

		const rampMesh = new THREE.Mesh(
            rampGeometry,
            new THREE.MeshStandardMaterial({ color: '#0000ff', wireframe: true, side: THREE.DoubleSide })
        );
		rampMesh.position.set(0, 0, 10)
		rampMesh.receiveShadow = true
		this.scene.add(rampMesh)

		const rampBody = this.world.createRigidBody(
			RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 10)
		)
		const rampPoints = new Float32Array(rampMesh.geometry.attributes.position!.array)
		const icosahedronShape = (RAPIER.ColliderDesc.convexHull(rampPoints) as RAPIER.ColliderDesc)
            .setFriction(1)
            .setRestitution(0) 
		this.world.createCollider(icosahedronShape, rampBody)

        if (this.debugFolder) {
            this.debugFolder
                .add((floor.material as THREE.MeshStandardMaterial), 'wireframe')
                .name('floorWireframe')
            this.debugFolder
                .addColor((floor.material as THREE.MeshStandardMaterial), 'color')
                .name('floorColor')

            this.debugFolder
                .add((rampMesh.material as THREE.MeshStandardMaterial), 'wireframe')
                .name('rampWireframe')
            this.debugFolder
                .addColor((rampMesh.material as THREE.MeshStandardMaterial), 'color')
                .name('rampColor')
        }
    }

    test_box() {
        const capsule = new THREE.Mesh(
			new THREE.CapsuleGeometry(0.5, 1.8, 4, 8),
			new THREE.MeshStandardMaterial({ color: '#00ff00', wireframe: true })
		)
		capsule.position.set(0, 1.4, 0)
		this.scene.add(capsule)

        const capsuleBody = this.world.createRigidBody(
			RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1.4, 0).setSleeping(false)
		)
		// lock rotation on the X and Z axis

        // 70kg = 686N
		capsuleBody.lockRotations(true, false)
		const capsuleShape = RAPIER.ColliderDesc.capsule(0.5, 0.9).setMass(1).setRestitution(0)
		
        this.world.createCollider(capsuleShape, capsuleBody)
        this.physics.register(capsule, capsuleBody)

        // store player references so tick can control movement
        this.playerMesh = capsule
        this.playerBody = capsuleBody
    }

    destroy() {
        this.debugFolder?.destroy()
        // stop input and tick handler
        // this.engine.time.off('tick')
    }

    // called every frame (registered early so movement is applied before physics.step)
    // tick() {
        // if (!this.playerBody) return

        // const dir = this.input.getMovementDirection()

        // // debug: log input dir so you can see it's captured
        // if (Math.abs(dir.x) > 0 || Math.abs(dir.z) > 0 || Math.abs(dir.y) > 0) {
        //     // eslint-disable-next-line no-console
        //     console.log('[Input] dir=', dir)
        // }

        // // configurable speed (units per second)
        // const speed = 5
        // const jumpImpulse = 5
        // // const verticalSpeed = 5

        // // get current velocity and preserve vertical (y)
        // const currentVel = this.playerBody.linvel()
        // const newVel = { x: dir.x * speed, y: currentVel.y, z: dir.z * speed }
        // this.playerBody.setLinvel(newVel, true)
        
        // // apply the new horizontal velocity
        // // console.log(y)
        // if (dir.y > 0 && Math.abs(currentVel.y) < 0.01) {
        //     this.playerBody.applyImpulse({ x: 0, y: jumpImpulse, z: 0 }, true)
        // }

        // debug: log velocities occasionally
        // eslint-disable-next-line no-console
        // console.log('[Physics] linvel=', this.playerBody.linvel())
    // }
}