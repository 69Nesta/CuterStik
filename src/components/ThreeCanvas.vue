<script setup lang="ts">
	import { onMounted } from 'vue';
	import { ThreeSceneService } from '@engine/three_scene_service.ts'

	onMounted(async () => {
		const canvas = document.getElementById('canvas') as HTMLCanvasElement;
		if (!canvas) return;

		ThreeSceneService.initializeEngine(canvas);
	});
</script>

<template>
	<canvas id="canvas"></canvas>
</template>

<style scoped>

</style>