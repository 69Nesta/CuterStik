import * as THREE from 'three'
import { Engine } from '@engine/engine';
import type GUI from 'lil-gui';
import type { Debug } from '@engine/debug.ts';
import type { Camera } from '@engine/render/camera.ts';
import type { Sizes } from '@engine/sizes.ts';

export class Renderer {
    engine: Engine
    canvas: HTMLCanvasElement
    sizes: Sizes
    scene: THREE.Scene
    camera: Camera
    instance!: THREE.WebGLRenderer
    debug: Debug
    debugFolder: GUI | undefined;

    constructor() {
        this.engine = new Engine()
        this.canvas = this.engine.canvas
        this.sizes = this.engine.sizes
        this.scene = this.engine.scene
        this.camera = this.engine.camera
        this.debug = this.engine.debug

        if (this.debug.active) {
            this.debugFolder = this.debug.ui?.addFolder('Environment')
        }

        this.setInstance()
    }

    setInstance() {
        this.instance = new THREE.WebGLRenderer({
            canvas: this.canvas,
            // antialias: true
        })

        // this.instance.toneMapping = THREE.CineonToneMapping
        // this.instance.toneMappingExposure = 1.75
        // this.instance.shadowMap.enabled = true
        // this.instance.shadowMap.type = THREE.PCFSoftShadowMap
        // this.instance.setClearColor('#ffffff')
        this.instance.setSize(this.sizes.width, this.sizes.height)
        this.instance.setPixelRatio(this.sizes.pixelRatio)
        // this.instance.physicallyCorrectLights = true

        this.scene.background = new THREE.Color('#72b6ff')

        if (this.debugFolder) {
            this.debugFolder.addColor(this.scene, 'background').name('Background')
        }
    }

    resize() {
        this.instance.setSize(this.sizes.width, this.sizes.height)
        this.instance.setPixelRatio(this.sizes.pixelRatio)
    }

    update() {
        this.instance.render(this.scene, this.camera.instance)
    }

    destroy() {
        this.debugFolder?.destroy()
    }
}