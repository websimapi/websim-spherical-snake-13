import * as THREE from 'three';
import { Snake } from './snake.js';
import { FoodManager } from './food-manager.js';
import { AudioManager } from './audio-manager.js';
import { hideLoader } from './loader.js';
import { getRippleHeight, getRandomPointOnSphere } from './math-utils.js';

export class Game {
    constructor(scene, camera, renderer, room) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.room = room;
        
        this.EARTH_RADIUS = 10;
        
        // Game State
        this.status = 'SPECTATING'; // SPECTATING, SPAWNING, PLAYING, DEAD
        this.score = 0;
        this.time = 0;
        this.invulnerableTimer = 0;
        this.spawnTimer = 0;
        
        // Multiplayer State
        this.remoteSnakes = new Map(); // clientId -> Snake instance

        // Visuals
        this.rippleUniforms = {
            uTime: { value: 0 },
            uRippleCenters: { value: new Array(5).fill().map(() => new THREE.Vector3()) },
            uRippleStartTimes: { value: new Array(5).fill(-1000) },
            uRippleIntensities: { value: new Array(5).fill(0) }
        };
        this.currentRippleIdx = 0;
        
        this.playerInfo = { username: 'Player', avatarUrl: '' };
        this.audioManager = new AudioManager();
        
        // Entities
        this.snake = new Snake(this.scene, this.EARTH_RADIUS);
        this.foodManager = new FoodManager(this.scene, this.EARTH_RADIUS);
        this.targetPoint = null;

        this.init();
    }

    get isGameOver() {
        return this.status === 'DEAD';
    }

    init() {
        this.audioManager.load('eat', './snake_eat.mp3');
        this.audioManager.load('die', './game_over.mp3');
        this.createEarth();
        
        // Start in spectator mode (invisible)
        this.snake.setOpacity(0);
        this.snake.head.visible = false;
    }

    onRoomInitialized() {
        const me = this.room.peers[this.room.clientId];
        if(me) this.setPlayerInfo(me);
        
        // Initial setup for room state if empty (host logic usually, but here optimistic)
        if (!this.room.roomState.foods) {
             this.room.updateRoomState({ foods: {} });
        }
    }

    setPlayerInfo(info) {
        this.playerInfo = info;
        const avatarEl = document.getElementById('player-avatar');
        const nameEl = document.getElementById('player-name');
        const playerCardEl = document.getElementById('player-card');

        if (nameEl && info.username) nameEl.textContent = info.username;
        if (!avatarEl) return;

        const fallbackUrl = './default_avatar.png';
        const primaryUrl = info.avatarUrl || fallbackUrl;

        const img = new Image();
        img.onload = () => {
            avatarEl.src = img.src;
            document.body.classList.add('ready');
            hideLoader();
            if (playerCardEl) playerCardEl.classList.add('visible');
        };
        img.src = primaryUrl === fallbackUrl ? fallbackUrl : primaryUrl;
    }
    
    createEarth() {
        const geometry = new THREE.SphereGeometry(this.EARTH_RADIUS, 64, 64);
        const material = new THREE.MeshStandardMaterial({
            color: 0x88ccff,
            emissive: 0x002244, 
            emissiveIntensity: 0.8,
            transparent: true,
            opacity: 0.7,
            roughness: 0.9,
            metalness: 0.0,
            side: THREE.DoubleSide
        });

        // Inject Ripple Shader
        material.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = this.rippleUniforms.uTime;
            shader.uniforms.uRippleCenters = this.rippleUniforms.uRippleCenters;
            shader.uniforms.uRippleStartTimes = this.rippleUniforms.uRippleStartTimes;
            shader.uniforms.uRippleIntensities = this.rippleUniforms.uRippleIntensities;

            shader.vertexShader = `varying vec3 vWorldPos;\n` + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace(
                '#include <worldpos_vertex>',
                `#include <worldpos_vertex>
                vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
            );

            const rippleFunc = `
                uniform float uTime;
                uniform vec3 uRippleCenters[5];
                uniform float uRippleStartTimes[5];
                uniform float uRippleIntensities[5];
                varying vec3 vWorldPos;

                float getRipple(int i, vec3 pos) {
                    float startTime = uRippleStartTimes[i];
                    if (startTime < 0.0) return 0.0;
                    float age = uTime - startTime;
                    if (age < 0.0 || age > 2.0) return 0.0;
                    vec3 center = uRippleCenters[i];
                    float intensity = uRippleIntensities[i];
                    float dotProd = dot(normalize(pos), normalize(center));
                    float angle = acos(clamp(dotProd, -1.0, 1.0));
                    float dist = angle * 10.0;
                    float speed = 8.0; 
                    float waveCenter = age * speed;
                    float distDiff = dist - waveCenter;
                    float ripple = 0.0;
                    if (abs(distDiff) < 2.0) {
                        ripple = sin(distDiff * 3.0) * exp(-distDiff * distDiff);
                    }
                    ripple *= (1.0 - age / 2.0);
                    ripple *= intensity;
                    return ripple;
                }
            `;

            shader.fragmentShader = rippleFunc + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <dithering_fragment>',
                `#include <dithering_fragment>
                float totalRipple = 0.0;
                for(int i=0; i<5; i++) {
                    totalRipple += getRipple(i, vWorldPos);
                }
                if (abs(totalRipple) > 0.01) {
                    float strength = smoothstep(0.0, 0.5, abs(totalRipple));
                    vec3 rippleColor = vec3(0.7, 0.9, 1.0);
                    gl_FragColor.rgb = mix(gl_FragColor.rgb, rippleColor, strength * 0.4);
                    gl_FragColor.rgb += rippleColor * strength * 0.2;
                }`
            );
        };

        this.earth = new THREE.Mesh(geometry, material);
        this.scene.add(this.earth);
        
        const atmGeometry = new THREE.SphereGeometry(this.EARTH_RADIUS * 1.03, 64, 64);
        const atmMaterial = new THREE.MeshBasicMaterial({
            color: 0x4488ff,
            transparent: true,
            opacity: 0.1,
            side: THREE.BackSide
        });
        this.scene.add(new THREE.Mesh(atmGeometry, atmMaterial));
    }

    spawnPlayer() {
        if (this.status === 'PLAYING' || this.status === 'SPAWNING') return;
        
        this.status = 'SPAWNING';
        this.score = 0;
        this.snake.reset();
        
        // Random spawn location
        const startPos = getRandomPointOnSphere(this.EARTH_RADIUS);
        this.snake.head.position.copy(startPos);
        this.snake.head.lookAt(new THREE.Vector3(0,0,0)); // temporary orientation
        // Point north-ish or random tangent
        const tangent = new THREE.Vector3(Math.random()-0.5, Math.random()-0.5, Math.random()-0.5);
        this.snake.head.lookAt(tangent.add(startPos));

        // Invulnerability
        this.invulnerableTimer = 5.0;
        this.spawnTimer = 0; // for segment animation
        
        // Visuals
        this.snake.head.visible = true;
        this.snake.setOpacity(0.5); // Ghostly
        
        // Hide UI
        document.getElementById('start-message').style.display = 'none';
        document.getElementById('game-over').classList.remove('visible');
        document.getElementById('game-over').classList.add('hidden');
        document.getElementById('player-score').innerText = '0';

        this.audioManager.resume();
    }

    setTarget(point) {
        if (this.status === 'SPECTATING' || this.status === 'DEAD') {
            this.spawnPlayer();
            return;
        }
        if (point) {
            this.targetPoint = point.clone().normalize().multiplyScalar(this.EARTH_RADIUS);
        }
    }

    triggerRipple(point, durationMs) {
        const idx = this.currentRippleIdx;
        this.rippleUniforms.uRippleCenters.value[idx].copy(point);
        this.rippleUniforms.uRippleStartTimes.value[idx] = this.time;
        
        let intensity = 0.15;
        if (durationMs > 200) {
            const factor = Math.min((durationMs - 200) / 400, 1.0);
            intensity = 0.15 + factor * 0.3;
        }
        this.rippleUniforms.uRippleIntensities.value[idx] = intensity;
        this.currentRippleIdx = (this.currentRippleIdx + 1) % 5;
        
        // Broadcast ripple? Optional, but nice for multiplayer
        // We use ephemeral events for this
        this.room.send({
            type: 'ripple',
            center: point.toArray(),
            duration: durationMs
        });
    }

    update(dt) {
        this.time += dt;
        this.rippleUniforms.uTime.value = this.time;
        
        const rippleFn = (pos) => getRippleHeight(
            pos, this.time,
            this.rippleUniforms.uRippleCenters.value,
            this.rippleUniforms.uRippleStartTimes.value,
            this.rippleUniforms.uRippleIntensities.value,
            this.EARTH_RADIUS
        );

        // 1. Process Remote Messages/Events (Ripples)
        this.room.onmessage = (evt) => {
            if (evt.data.type === 'ripple' && !evt.data.echo) {
                 const center = new THREE.Vector3().fromArray(evt.data.center);
                 this.triggerRipple(center, evt.data.duration);
            }
        };

        // 2. Handle Game Logic based on Status
        if (this.status === 'SPAWNING') {
            this.invulnerableTimer -= dt;
            this.spawnTimer += dt;
            
            // "Spawn part by part" - We add segments gradually
            // Snake starts with 0 segments in reset(), actually it has STARTING_SEGMENTS.
            // Let's modify visual opacity/scale based on time
            
            if (this.spawnTimer > 1.0) {
                this.status = 'PLAYING';
                this.snake.setOpacity(1.0);
            } else {
                // Fade in
                this.snake.setOpacity(0.5 + this.spawnTimer * 0.5);
            }
            
            // Logic update
            this.snake.update(dt, this.targetPoint, rippleFn);
            
        } else if (this.status === 'PLAYING') {
            if (this.invulnerableTimer > 0) {
                this.invulnerableTimer -= dt;
            }
            
            this.snake.setInvulnerable(this.invulnerableTimer > 0, this.time);
            
            const moveDist = this.snake.update(dt, this.targetPoint, rippleFn);
            if (moveDist > 0 && this.targetPoint && this.snake.head.position.distanceTo(this.targetPoint) < 1.0) {
                this.targetPoint = null;
            }
            
            // Food Logic
            this.foodManager.sync(this.room.roomState.foods, rippleFn);
            const eatenIds = this.foodManager.checkCollisions(this.snake.head.position);
            
            if (eatenIds.length > 0) {
                const foodsUpdate = {};
                eatenIds.forEach(id => {
                    foodsUpdate[id] = null; // Mark for deletion
                    this.score++;
                    this.audioManager.play('eat', 0.3);
                    this.snake.addSegment();
                    this.snake.triggerTongue();
                });
                
                // Update Room State
                this.room.updateRoomState({ foods: foodsUpdate });
                document.getElementById('player-score').innerText = this.score;
            }
            
            // Check Death (Self or Remote)
            if (this.invulnerableTimer <= 0) {
                if (this.snake.checkSelfCollision()) {
                    this.die();
                } else {
                    // Check remote snakes
                    for (const [id, remoteSnake] of this.remoteSnakes) {
                        const peerData = this.room.presence[id];
                        if (peerData && peerData.invulnerable) continue; // Don't crash into invulnerable people? Or maybe pass through
                        
                        // Collision with remote segments
                        // Simple dist check
                        for(const seg of remoteSnake.segments) {
                             if (this.snake.head.position.distanceTo(seg.position) < 1.0) {
                                 this.die();
                                 break;
                             }
                        }
                    }
                }
            }
        } else {
            // Spectating / Dead
            // Update orbit camera? Or just follow last position
            if (this.status === 'SPECTATING') {
                this.camera.position.x = Math.sin(this.time * 0.2) * 30;
                this.camera.position.z = Math.cos(this.time * 0.2) * 30;
                this.camera.lookAt(0,0,0);
            }
            
            // Still sync food visuals
            this.foodManager.sync(this.room.roomState.foods, rippleFn);
        }

        // 3. Update Remote Players
        this.updateRemotePlayers(rippleFn);

        // 4. Sync Presence
        this.syncPresence();

        // 5. Update Camera (when playing)
        if (this.status === 'PLAYING' || this.status === 'SPAWNING') {
            this.updateCamera(dt);
        }
        
        // Host Logic for spawning food (primitive: if foods low, spawn)
        // Only if I am the lowest ID peer (stable host)
        this.manageFoodSpawning();
    }
    
    updateRemotePlayers(rippleFn) {
        const peers = this.room.peers;
        const presence = this.room.presence;
        
        const activeIds = new Set();
        
        for (const clientId in peers) {
            if (clientId === this.room.clientId) continue; // Skip self
            
            activeIds.add(clientId);
            const pData = presence[clientId];
            
            let remoteSnake = this.remoteSnakes.get(clientId);
            if (!remoteSnake) {
                remoteSnake = new Snake(this.scene, this.EARTH_RADIUS);
                // Differentiate color slightly?
                this.remoteSnakes.set(clientId, remoteSnake);
            }
            
            if (pData && pData.status === 'PLAYING' || pData.status === 'SPAWNING') {
                 remoteSnake.updateFromData(pData, rippleFn);
                 // Handle remote invulnerability visual
                 if (pData.invulnerable) remoteSnake.setInvulnerable(true, this.time);
                 else remoteSnake.setInvulnerable(false);
            } else {
                // Hide
                remoteSnake.setOpacity(0);
                remoteSnake.head.visible = false;
            }
        }
        
        // Cleanup disconnected
        for (const [id, snake] of this.remoteSnakes) {
            if (!activeIds.has(id)) {
                // remove meshes
                this.scene.remove(snake.head);
                snake.segments.forEach(s => this.scene.remove(s));
                this.remoteSnakes.delete(id);
            }
        }
    }
    
    syncPresence() {
        if (this.status === 'SPECTATING' || this.status === 'DEAD') {
            this.room.updatePresence({ status: this.status });
            return;
        }
        
        this.room.updatePresence({
            status: this.status,
            invulnerable: this.invulnerableTimer > 0,
            head: {
                pos: this.snake.head.position.toArray(),
                quat: this.snake.head.quaternion.toArray()
            },
            segments: this.snake.segments.map(s => ({
                pos: s.position.toArray(),
                quat: s.quaternion.toArray(),
                color: s.material.color.getHex()
            }))
        });
    }
    
    manageFoodSpawning() {
        // Simple Host Check: am I the first key in peers?
        const ids = Object.keys(this.room.peers).sort();
        if (ids[0] !== this.room.clientId) return;
        
        const currentFoods = this.room.roomState.foods || {};
        const count = Object.keys(currentFoods).length;
        
        if (count < 5) { // Maintain 5 foods
            const id = Math.random().toString(36).substr(2, 9);
            const pos = getRandomPointOnSphere(this.EARTH_RADIUS);
            
            this.room.updateRoomState({
                foods: {
                    [id]: {
                        x: pos.x, y: pos.y, z: pos.z,
                        type: 'normal'
                    }
                }
            });
        }
    }
    
    die() {
        this.status = 'DEAD';
        this.audioManager.play('die');
        
        // Drop Food (1/2 score)
        const dropCount = Math.floor(this.score / 2);
        const updates = {};
        
        for(let i=0; i<dropCount; i++) {
             const id = 'bonus-' + Math.random().toString(36).substr(2,9);
             // Scatter around death point
             const offset = new THREE.Vector3(Math.random()-0.5, Math.random()-0.5, Math.random()-0.5).normalize().multiplyScalar(2.0);
             const pos = this.snake.head.position.clone().add(offset).normalize().multiplyScalar(this.EARTH_RADIUS);
             
             updates[id] = {
                 x: pos.x, y: pos.y, z: pos.z,
                 type: 'bonus'
             };
        }
        
        if (dropCount > 0) {
            this.room.updateRoomState({ foods: updates });
        }
        
        // UI
        const gameOverEl = document.getElementById('game-over');
        gameOverEl.classList.remove('hidden');
        gameOverEl.classList.add('visible');
    }

    updateCamera(dt) {
        const idealCameraPos = this.snake.head.position.clone().normalize().multiplyScalar(30);
        this.camera.position.lerp(idealCameraPos, 2.0 * dt);
        this.camera.lookAt(0, 0, 0);
        const snakeForward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.snake.head.quaternion);
        this.camera.up.copy(snakeForward);
    }
}