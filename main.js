import * as THREE from 'three';
import { Game } from './game.js';
import { initLoader, showLoader, hideLoader } from './loader.js';

// Start Loading Screen immediately
initLoader();

// Setup basic Three.js scene
const scene = new THREE.Scene();

// Camera setup
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
// Position camera for a nice orbital view
const cameraRig = new THREE.Group();
scene.add(cameraRig);
cameraRig.add(camera);
camera.position.z = 25;
camera.position.y = 10;
camera.lookAt(0, 0, 0);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Optimize for mobile
document.getElementById('game-container').appendChild(renderer.domElement);

// Lighting
// Bright ambient light to ensure no part of the sphere is too dark
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); 
scene.add(ambientLight);

// Hemisphere light for natural, omnidirectional illumination
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
scene.add(hemiLight);

// Camera-mounted light removed to prevent glare.
// Note: Camera is already added to the scene via cameraRig

 // Setup User Info via WebsimSocket
const room = new WebsimSocket();

// Initialize Game (pass room)
const game = new Game(scene, camera, renderer, room);

// Mute toggle button
const muteBtn = document.getElementById('mute-toggle');
if (muteBtn) {
    muteBtn.addEventListener('click', () => {
        const muted = game.audioManager.toggleMuted();
        muteBtn.textContent = muted ? '🔇' : '🔊';
    });
}

room.initialize().then(() => {
    game.onRoomInitialized();
});

// Raycaster for interaction
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function getIntersection(x, y) {
    mouse.x = (x / window.innerWidth) * 2 - 1;
    mouse.y = -(y / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    return raycaster.intersectObject(game.earth);
}

function handleInput(x, y) {
    const intersects = getIntersection(x, y);

    if (intersects.length > 0) {
        // Pass the intersection point to the game logic
        game.setTarget(intersects[0].point);
    } else if (game.status === 'SPECTATING' || game.isGameOver) {
        // Allow tapping anywhere to join/respawn if we missed the earth
        game.setTarget(null);
    }
    
    // Hide start message if we successfully interacted
    if (intersects.length > 0 || game.status === 'SPECTATING' || game.isGameOver) {
        const msg = document.getElementById('start-message');
        if(msg) msg.style.display = 'none';
    }
}

// Ripple Logic
let interactionStart = 0;

function handleRippleTrigger(x, y, duration) {
    const intersects = getIntersection(x, y);
    if (intersects.length > 0) {
        game.triggerRipple(intersects[0].point, duration);
    }
}

// Event Listeners
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Touch events for mobile
window.addEventListener('touchstart', (e) => {
    interactionStart = Date.now();
    const touch = e.touches[0];
    handleInput(touch.clientX, touch.clientY);
}, { passive: false });

window.addEventListener('touchend', (e) => {
    if (e.changedTouches.length > 0) {
        const touch = e.changedTouches[0];
        const duration = Date.now() - interactionStart;
        handleRippleTrigger(touch.clientX, touch.clientY, duration);
    }
});

window.addEventListener('touchmove', (e) => {
    // Allow dragging to update direction continuously
    if(!game.isGameOver) {
        const touch = e.touches[0];
        handleInput(touch.clientX, touch.clientY);
    }
}, { passive: false });

// Mouse events for desktop testing
window.addEventListener('mousedown', (e) => {
    interactionStart = Date.now();
    handleInput(e.clientX, e.clientY);
});
window.addEventListener('mouseup', (e) => {
    if(!game.isGameOver) {
        const duration = Date.now() - interactionStart;
        handleRippleTrigger(e.clientX, e.clientY, duration);
    }
});
window.addEventListener('mousemove', (e) => {
    if(e.buttons === 1 && !game.isGameOver) handleInput(e.clientX, e.clientY);
});

// UI Event Handlers
const gameOverScreen = document.getElementById('game-over');
const replayContainer = document.getElementById('replay-container');

// Multiplayer input handling handles restarts now via tap

// Animation Loop
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    
    const dt = Math.min(clock.getDelta(), 0.1); // Cap delta time
    
    // Always update game state (it handles spectating/playing logic internally)
    game.update(dt);
    
    renderer.render(scene, camera);
}

animate();