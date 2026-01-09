import * as THREE from 'three';
import { getRandomPointOnSphere } from './math-utils.js';

export class FoodManager {
    constructor(scene, earthRadius) {
        this.scene = scene;
        this.EARTH_RADIUS = earthRadius;
        
        // Map of foodId -> Mesh
        this.foodMeshes = new Map();
        
        // Reusable geometry/material
        this.foodGeo = new THREE.SphereGeometry(0.5, 16, 16);
        this.foodMat = new THREE.MeshStandardMaterial({ 
            color: 0xffaa00, 
            emissive: 0xff0000, 
            emissiveIntensity: 0.5 
        });
        this.bonusGeo = new THREE.SphereGeometry(0.25, 8, 8);
        this.bonusMat = new THREE.MeshStandardMaterial({ 
            color: 0xffff00, 
            emissive: 0xffaa00,
            emissiveIntensity: 0.5 
        });
    }

    reset() {
        // We do not clear foods on local reset anymore, as they are synced
    }

    // Called every frame with latest Room State
    sync(roomStateFoods, rippleFn) {
        if (!roomStateFoods) return;

        const currentIds = new Set(Object.keys(roomStateFoods));
        
        // Remove stale foods
        for (const [id, mesh] of this.foodMeshes) {
            if (!currentIds.has(id)) {
                this.scene.remove(mesh);
                this.foodMeshes.delete(id);
            }
        }

        // Add/Update foods
        for (const id of currentIds) {
            const data = roomStateFoods[id];
            if (!data) continue;

            let mesh = this.foodMeshes.get(id);
            if (!mesh) {
                const isBonus = data.type === 'bonus';
                mesh = new THREE.Mesh(
                    isBonus ? this.bonusGeo : this.foodGeo,
                    isBonus ? this.bonusMat : this.foodMat
                );
                this.scene.add(mesh);
                this.foodMeshes.set(id, mesh);
                
                // Set initial pos
                mesh.position.set(data.x, data.y, data.z);
            }

            // Apply Ripple Visuals
            mesh.position.setLength(this.EARTH_RADIUS);
            if (rippleFn) {
                const h = rippleFn(mesh.position);
                if (Math.abs(h) > 0.01) {
                    mesh.position.setLength(this.EARTH_RADIUS + h);
                }
            }
        }
    }

    // Returns array of food IDs collided with
    checkCollisions(snakeHeadPos) {
        const collidedIds = [];
        const headNorm = snakeHeadPos.clone().normalize();

        for (const [id, mesh] of this.foodMeshes) {
            const foodNorm = mesh.position.clone().normalize();
            // Use slightly larger radius for easy eating
            if (headNorm.distanceTo(foodNorm) * this.EARTH_RADIUS < 1.5) {
                collidedIds.push(id);
            }
        }
        return collidedIds;
    }
}