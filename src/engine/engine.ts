import { Scene } from 'three';

import { Debug } from '@engine/debug.ts';
import { Sizes } from '@engine/sizes.ts';
import { Time } from '@engine/time.ts';
import { Camera } from '@engine/render/camera.ts';
import { Renderer } from '@engine/render/renderer.ts';
import { World } from '@engine/world.ts'
// import { Raycaster } from '@engine/utils/raycaster.ts';
// import { SceneEngine } from '@engine/scene/configurator.ts';
// import { TextureLoader } from '@engine/utils/texture_loader.ts';

let instance: null | Engine = null;

export class Engine {
    public canvas!: HTMLCanvasElement;
    public debug!: Debug;
    public sizes!: Sizes;
    public time!: Time;
    public scene!: Scene;
    public world!: World;
    // // public resources!: Resources;
    // public textureLoader!: TextureLoader;
    public camera!: Camera;
    // public raycaster!: Raycaster;
    public renderer!: Renderer;
    // public sceneEngine!: SceneEngine;

    public debugObject!: { printCameraCoords?: () => void };

    constructor(_canvas?: HTMLCanvasElement) {
        // Singleton
        if (instance) return instance;
        instance = this;

        // Global access (not useful)
        // window.experience = this

        // Options
        if (!_canvas) throw new Error('Canvas is not defined');
        this.canvas = _canvas

        // Setup
        this.debug = new Debug();
        this.sizes = new Sizes();
        this.time = new Time();
        this.scene = new Scene();
        // // this.resources = new Resources(sources);
        // this.textureLoader = new TextureLoader();
        this.camera = new Camera();
        // this.raycaster = new Raycaster();

        this.world = new World();

        this.renderer = new Renderer();
        // this.sceneEngine = new SceneEngine();


        this.sizes.on('resize', this.resize.bind(this));
        this.time.on('tick', this.update.bind(this));


        this.debugObject = {};
        if (this.debug.active) {
            this.debugObject = {
                printCameraCoords: () => this.camera.printCameraCoords()
            }

            this.debug.ui?.add(this.debugObject, 'printCameraCoords');
        }
    }

    resize() {
        this.camera.resize()
        this.renderer.resize()
    }

    update() {
        this.camera.update()
        // this.sceneEngine.update()

        this.renderer.update()
    }

    destroy() {
        this.sizes.off('resize')
        this.time.off('tick')

        // if (this.debug.active) {
        //     this.debug.ui?.destroy()
        // }
    }
}
