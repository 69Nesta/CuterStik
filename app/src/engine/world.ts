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

    destroy() {
        this.debugFolder?.destroy()
    }
}