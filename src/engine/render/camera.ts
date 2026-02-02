import * as THREE from 'three'
import { OrbitControls } from 'three/addons'
import { Engine } from '@engine/engine';
import type { Sizes } from '@engine/sizes.ts';

export class Camera {
    engine: Engine;
    sizes: Sizes
    scene: THREE.Scene
    canvas: HTMLCanvasElement
    instance!: THREE.PerspectiveCamera
    controls!: OrbitControls

    constructor() {
        this.engine = new Engine()
        this.sizes = this.engine.sizes
        this.scene = this.engine.scene
        this.canvas = this.engine.canvas

        this.setInstance()
        this.setControls()
    }

    setInstance() {
        this.instance = new THREE.PerspectiveCamera(35, this.sizes.width / this.sizes.height, 0.1, 1000)
        this.instance.position.set(15, 5, 15)

        this.scene.add(this.instance)
    }

    setControls() {
        this.controls = new OrbitControls(this.instance, this.canvas)
        this.controls.enableDamping = true
    }

    printCameraCoords() {
        console.log({
            x: this.instance.position.x.toFixed(2),
            y: this.instance.position.y.toFixed(2),
            z: this.instance.position.z.toFixed(2)
        })
    }

    resize() {
        this.instance.aspect = this.sizes.width / this.sizes.height
        this.instance.updateProjectionMatrix()
    }

    update() {
        this.controls.update()
    }
}