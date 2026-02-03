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
            new THREE.PlaneGeometry(40, 40),
            new THREE.MeshStandardMaterial({ color: '#777777', wireframe: true })
        )
        floor.rotation.x = - Math.PI / 2
        floor.receiveShadow = true
        this.scene.add(floor)
        this.map.set('floor', floor)

        const floorBody = this.world.createRigidBody(
            RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0)
        )
        const floorShape = RAPIER.ColliderDesc.cuboid(20, 0, 20).setRestitution(0)
        this.world.createCollider(floorShape, floorBody)

        const firstBox = this.createBox(
            new THREE.Vector3(0, 0.5, 7.5),
            new THREE.Vector3(10, 1, 5),
            '#0000ff',
            'fixed'
        )

        const secondBox = this.createBox(
            new THREE.Vector3(-7.5, 1, 5),
            new THREE.Vector3(5, 2, 10),
            '#23f208',
            'fixed'
        )

        const thirdBox = this.createBox(
            new THREE.Vector3(-7.5, 1.5, -2.5),
            new THREE.Vector3(5, 3, 5),
            '#f20808',
            'fixed'
        )

        this.map.set('firstBox', firstBox.mesh)
        this.map.set('secondBox', secondBox.mesh)
        this.map.set('thirdBox', thirdBox.mesh)

        if (this.debugFolder) {
            this.debugFolder
                .add((floor.material as THREE.MeshStandardMaterial), 'wireframe')
                .name('floorWireframe')
            this.debugFolder
                .addColor((floor.material as THREE.MeshStandardMaterial), 'color')
                .name('floorColor')
        }
    }

    createBox(position: THREE.Vector3, size: THREE.Vector3, color: string, bodyType: 'dynamic' | 'fixed' = 'dynamic') {
        const boxMesh = new THREE.Mesh(
            new THREE.BoxGeometry(size.x, size.y, size.z),
            new THREE.MeshStandardMaterial({ color: color, wireframe: true } )
        );
        boxMesh.position.copy(position)
        boxMesh.castShadow = true
        this.scene.add(boxMesh)

        const boxBody = this.world.createRigidBody(
            RAPIER.RigidBodyDesc[bodyType]().setTranslation(position.x, position.y, position.z)
        )
        const boxShape = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
                                .setMass(1)
                                .setRestitution(0)
        this.world.createCollider(boxShape, boxBody)

        if (bodyType === 'dynamic')
            this.physics.register(boxMesh, boxBody)

        return { mesh: boxMesh, body: boxBody }
    }

    destroy() {
        this.debugFolder?.destroy()
    }
}