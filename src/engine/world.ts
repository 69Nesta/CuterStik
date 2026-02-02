import * as THREE from 'three';
import { Engine } from '@engine/engine.ts';
import { Camera } from '@engine/render/camera.ts';
import type { Debug } from '@engine/debug.ts';
import * as RAPIER from '@dimforge/rapier3d';

import { type GUI } from 'lil-gui';
import type { Physics } from './physics';

export class World {
    engine: Engine;
    scene: THREE.Scene
    camera: Camera;
    debug: Debug;
    physics: Physics;
    world: RAPIER.World;
    debugFolder: GUI | undefined;

    floor: THREE.Mesh | undefined;

    constructor() {
        this.engine = new Engine()
        this.scene = this.engine.scene
        this.camera = this.engine.camera
        this.debug = this.engine.debug
        this.physics = this.engine.physics
        this.world = this.physics.world


        if (this.debug.active) {
            this.debugFolder = this.debug.ui?.addFolder('environment');
        }

        this.setup_environement()
        this.setup_floor()
        this.test_box()
    }


	setup_environement() {
		const skyColor = 0xb1e1ff;	
		const groundColor = 0xb97a20;
		const intensity = 3;
		const light = new THREE.HemisphereLight(skyColor, groundColor, intensity);
		this.scene.add(light);
	}

    setup_floor() {
        this.floor = new THREE.Mesh(
            new THREE.PlaneGeometry(20, 20),
            new THREE.MeshStandardMaterial({ color: '#777777', wireframe: true })
        )
        this.floor.rotation.x = - Math.PI / 2
        this.floor.receiveShadow = true
        this.scene.add(this.floor)

        const floorBody = this.world.createRigidBody(
            RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0)
        )
        const floorShape = RAPIER.ColliderDesc.cuboid(10, 0, 10)
        this.world.createCollider(floorShape, floorBody)

        if (this.debugFolder) {
            this.debugFolder
                .add((this.floor.material as THREE.MeshStandardMaterial), 'wireframe')
                .name('floorWireframe')
            this.debugFolder
                .addColor((this.floor.material as THREE.MeshStandardMaterial), 'color')
                .name('floorColor')
        }
    }

    test_box() {
        const box = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshStandardMaterial({ color: '#ff0000', wireframe: true })
        )
        this.scene.add(box)

        const cubeBody = this.world.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0)
        )
        const cubeShape = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setMass(1).setRestitution(0.6)
        this.world.createCollider(cubeShape, cubeBody)
        this.physics.register(box, cubeBody)
        
        if (this.debugFolder)
            this.debugFolder.addColor((box.material as THREE.MeshStandardMaterial), 'color')
    }

    destroy() {
        this.debugFolder?.destroy()
    }
}