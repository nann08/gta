import * as THREE from 'three';
import { createPlayerModel } from './player.js';

// --- Car Physics Constants (Simplified) ---
const MAX_SPEED = 20; // Units/second
const ACCELERATION = 25; // Units/second^2
const DRAG = 0.98; // Multiplier applied every frame (reduces speed)
const ANGULAR_DRAG = 0.9; // Multiplier applied to steering speed
const STEERING_SPEED = 0.05; // Radians/frame
const HANDBRAKE_DRAG = 0.85; // Heavy drag multiplier for drifting

export class Car {
    constructor(id, color, isLocal = false) {
        this.id = id;
        this.isLocal = isLocal;
        this.mesh = createPlayerModel(color);
        
        // Physics state
        this.state = {
            position: new THREE.Vector3(0, 0.6, 0),
            rotation: 0, // Y-axis rotation in radians
            velocity: new THREE.Vector3(0, 0, 0),
            angularVelocity: 0,
            // Input state (only used by local car)
            input: {
                forward: false,
                backward: false,
                left: false,
                right: false,
                handbrake: false
            }
        };

        // For interpolation/reconciliation
        this.lastUpdateTime = performance.now();
        this.history = []; // State history for local car (reconciliation)
    }

    // --- Input Handling ---
    handleInput(input) {
        this.state.input = input;
    }

    // --- Physics Update ---
    update(deltaSeconds) {
        const state = this.state;
        
        // 1. Acceleration/Deceleration
        let throttle = 0;
        if (state.input.forward) throttle += ACCELERATION;
        if (state.input.backward) throttle -= ACCELERATION;

        // Apply acceleration in the direction the car is currently facing (Z-axis local)
        const directionVector = new THREE.Vector3(0, 0, 1);
        directionVector.applyAxisAngle(new THREE.Vector3(0, 1, 0), state.rotation);
        
        state.velocity.add(directionVector.multiplyScalar(throttle * deltaSeconds));

        // 2. Drag and Handbrake
        let currentDrag = DRAG;
        if (state.input.handbrake) {
            currentDrag = HANDBRAKE_DRAG;
            // Apply heavy side-drag for drifting feel (optional, but makes it slide)
            state.velocity.multiplyScalar(Math.pow(currentDrag, deltaSeconds * 60)); // Higher power for quick friction
        } else {
            state.velocity.multiplyScalar(Math.pow(currentDrag, deltaSeconds * 60)); // Standard drag
        }
        
        // Clamp speed
        if (state.velocity.length() > MAX_SPEED) {
            state.velocity.setLength(MAX_SPEED);
        }

        // 3. Steering
        let steering = 0;
        if (state.input.left) steering += STEERING_SPEED;
        if (state.input.right) steering -= STEERING_SPEED; // Steering inverted for local car logic

        // Apply steering only if there is forward or backward movement
        const speed = state.velocity.length();
        if (speed > 1) { // Only steer if moving
            // Base steering speed is multiplied by how fast the car is moving
            const effectiveSteering = steering * (speed / MAX_SPEED) * 2; 
            
            // Angular velocity for smooth rotation
            state.angularVelocity += effectiveSteering;
        }

        // Apply angular drag
        state.angularVelocity *= ANGULAR_DRAG;

        // Apply rotation
        state.rotation += state.angularVelocity * deltaSeconds;

        // 4. Position Update
        state.position.add(state.velocity.clone().multiplyScalar(deltaSeconds));

        // Ensure car stays above ground
        state.position.y = 0.6; 
        
        // 5. Update Mesh Position and Rotation
        this.mesh.position.copy(state.position);
        this.mesh.rotation.y = state.rotation;
        
        // For the local car, record the state for reconciliation
        if (this.isLocal) {
            this.history.push({ 
                timestamp: performance.now(), 
                position: state.position.clone(),
                rotation: state.rotation,
                velocity: state.velocity.clone(),
                input: { ...state.input } 
            });
            // Keep history list manageable
            while (this.history.length > 300) {
                this.history.shift();
            }
        }

        this.lastUpdateTime = performance.now();
    }

    // --- State Management for Networking ---

    // Sets the car's state directly (used for remote players or reconciliation)
    setState(newState) {
        this.state.position.copy(newState.position);
        this.state.rotation = newState.rotation;
        this.state.velocity.copy(newState.velocity);
        // Note: We don't necessarily update input for remote cars, but it's available if needed.
        
        // Update mesh immediately
        this.mesh.position.copy(this.state.position);
        this.mesh.rotation.y = this.state.rotation;
    }
    
    // Gets the current state to send over the network
    getState() {
        return {
            position: this.state.position,
            rotation: this.state.rotation,
            velocity: this.state.velocity,
            input: this.state.input,
            timestamp: this.lastUpdateTime
        };
    }
}
