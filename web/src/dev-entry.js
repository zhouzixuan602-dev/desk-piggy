// Dev-only: a static turntable for looking at the model.
import * as THREE from 'three';
import { createStage3D } from './stage3d.js';
import { createPig, applyPose, REST } from './pig.js';

const canvas = document.getElementById('c');
const stage = createStage3D(canvas);
const pig = createPig();
stage.scene.add(pig.root);
stage.resize(canvas.clientWidth, canvas.clientHeight, 2);
window.__dev = {
  THREE, stage, pig, REST,
  pose(p = {}, viewYaw = 0) {
    applyPose(pig.rig, { ...REST, ...p });
    pig.root.rotation.y = viewYaw;
    stage.render();
  },
};
window.__dev.pose();
