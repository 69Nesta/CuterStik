import { Engine } from '@engine/engine.ts';


export let engine: Engine;
const initializeEngine = (canvas: HTMLCanvasElement) => {
    engine = new Engine(canvas);
}

export const ThreeSceneService = {
    initializeEngine: initializeEngine
}