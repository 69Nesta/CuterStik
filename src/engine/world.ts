import * as THREE from 'three';
import { Engine } from '@engine/engine.ts';
import { Camera } from '@engine/render/camera.ts';
import type { Debug } from '@engine/debug.ts';

import { type GUI } from 'lil-gui';

export class World {
    engine: Engine;
    scene: THREE.Scene
    camera: Camera;
    debug: Debug;
    debugFolder: GUI | undefined;

    floor: THREE.Mesh | undefined;

    constructor() {
        this.engine = new Engine()
        this.scene = this.engine.scene
        this.camera = this.engine.camera
        this.debug = this.engine.debug

		this.setup_environement()


        if (this.debug.active) {
            this.debugFolder = this.debug.ui?.addFolder('environment');
        }

        this.floor = new THREE.Mesh(
            new THREE.PlaneGeometry(10, 10),
            new THREE.MeshStandardMaterial({ color: '#777777', wireframe: true })
        )
        this.floor.rotation.x = - Math.PI * 0.5
        this.floor.position.y = 0
        this.scene.add(this.floor)


        const test = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshStandardMaterial({ color: '#ff0000', wireframe: true })
        )
        test.position.set(0, 1, 0)
        this.scene.add(test)

        if (this.debug.active)
            this.debug.ui?.addColor(test.material, 'color')

    }


	setup_environement() {
		const skyColor = 0xb1e1ff;	
		const groundColor = 0xb97a20;
		const intensity = 3;
		const light = new THREE.HemisphereLight(skyColor, groundColor, intensity);
		this.scene.add(light);
	}

    destroy() {
        this.debugFolder?.destroy()
    }
}