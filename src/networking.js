import * as THREE from 'three';
import { Player } from './player.js';
import { Car } from './car.js';

// --- Networking Constants ---
const SERVER_URL = `${window.location.protocol}//${window.location.hostname}:3000`; // Use Vercel route
const INTERPOLATION_DELAY = 100; // ms: Time difference between render time and server time
const MAX_STATE_BUFFER = 5;

/**
 * Handles all Socket.io communication, state management for remote objects,
 * client-side prediction, and server reconciliation.
 */
export class Networking {
    constructor(game) {
        this.game = game;
        this.socket = null;
        this.remotePlayers = {};
        this.remoteCars = {};
        
        // Prediction and Reconciliation state
        this.inputSequence = 0;
        this.pendingInputs = [];
        this.serverStates = []; // For reconciliation
        this.serverCarStates = []; // For vehicle reconciliation

        // Ping tracking
        this.ping = 0;
        this.lastPingTime = 0;
        this.pingInterval = null;
    }

    // Connects to the Vercel Serverless Function route
    connect() {
        // For local development, uncomment the next line and comment the line after it:
        // this.socket = io('http://localhost:3000');
        
        // For Vercel deployment, use the /api/socket route
        this.socket = io(window.location.origin, {
            path: '/api/socket',
            transports: ['websocket']
        });

        this.setupSocketListeners();
        this.startPingTracker();
    }

    setupSocketListeners() {
        this.socket.on('connect', () => {
            console.log('Connected to server. ID:', this.socket.id);
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server.');
        });
        
        this.socket.on('pong', (time) => {
            this.ping = Date.now() - time;
            document.getElementById('ping-display').textContent = `Ping: ${this.ping} ms`;
        });
        
        // Initial state from server
        this.socket.on('initialState', (state) => {
            this.game.localPlayer = new Player(this.socket.id, true);
            this.game.scene.add(this.game.localPlayer.mesh);
            
            // Spawn initial cars
            for (const carId in state.cars) {
                 const carState = state.cars[carId];
                 const car = new Car(carId, carState.p);
                 car.driverId = carState.dId;
                 this.game.cars[carId] = car;
                 this.game.scene.add(car.mesh);
            }
            
            // Set the local player's starting position based on server
            this.game.localPlayer.position.copy(state.player.p);
            this.game.localPlayer.yaw = state.player.y;
            this.game.localPlayer.updateMesh();

            // Spawn remote players
            for (const playerId in state.players) {
                if (playerId !== this.socket.id) {
                    this.addRemotePlayer(playerId, state.players[playerId]);
                }
            }
        });

        // Server snapshot (heartbeat)
        this.socket.on('gameSnapshot', this.handleSnapshot.bind(this));
        
        // Chat
        this.socket.on('chatMessage', (data) => {
            this.game.addChatMessage(data.senderId, data.message);
        });
        
        // Mission updates
        this.socket.on('missionComplete', (data) => {
            this.game.addChatMessage('SERVER', `Mission '${data.title}' completed by Player ${data.playerId}!`);
        });
    }
    
    // --- Ping Tracker ---
    startPingTracker() {
        this.pingInterval = setInterval(() => {
            this.socket.emit('ping', Date.now());
        }, 1000);
    }
    
    // --- State Update Handling ---
    addRemotePlayer(id, snapshot) {
        const player = new Player(id, false);
        player.applySnapshot(snapshot);
        this.remotePlayers[id] = player;
        this.game.scene.add(player.mesh);
    }
    
    removeRemotePlayer(id) {
        if (this.remotePlayers[id]) {
            this.remotePlayers[id].remove();
            delete this.remotePlayers[id];
        }
    }

    handleSnapshot(snapshot) {
        const localPlayer = this.game.localPlayer;
        if (!localPlayer) return;

        // 1. Store server state for reconciliation
        this.serverStates.push(snapshot);
        while (this.serverStates.length > MAX_STATE_BUFFER) {
            this.serverStates.shift();
        }

        // 2. Server Reconciliation (Client-Side Prediction Correction)
        // If the player is driving, the server is fully authoritative for the car, so no reconciliation is needed for the player.
        if (!localPlayer.isDriving && localPlayer.inputSequence && snapshot.lastProcessedInput) {
            // Find the state corresponding to the last processed input
            const lastProcessedState = snapshot.players[localPlayer.id];

            if (lastProcessedState) {
                const serverPos = new THREE.Vector3(lastProcessedState.p.x, lastProcessedState.p.y, lastProcessedState.p.z);
                const posError = localPlayer.position.distanceTo(serverPos);

                // Reconcile if error is significant (e.g., > 1 meter)
                if (posError > 1.0) {
                    console.warn(`Correction applied. Error: ${posError.toFixed(2)}m`);
                    // Snap the client to the server's authoritative position
                    localPlayer.position.copy(serverPos);
                    localPlayer.yaw = lastProcessedState.y;
                    
                    // Re-simulate all pending inputs since the reconciled state
                    let i = 0;
                    while (i < this.pendingInputs.length) {
                        const input = this.pendingInputs[i];
                        if (input.sequence <= snapshot.lastProcessedInput) {
                            // Input was processed by server, discard
                            this.pendingInputs.splice(i, 1);
                        } else {
                            // Re-apply input to new position
                            localPlayer.update(input.deltaTime, input);
                            i++;
                        }
                    }
                }
            }
        }

        // 3. Update Remote Players (Interpolation setup)
        for (const playerId in snapshot.players) {
            if (playerId !== this.socket.id) {
                if (!this.remotePlayers[playerId]) {
                    this.addRemotePlayer(playerId, snapshot.players[playerId]);
                } else {
                    this.remotePlayers[playerId].applySnapshot(snapshot.players[playerId]);
                }
            }
        }
        
        // Remove disconnected players
        for (const playerId in this.remotePlayers) {
            if (!snapshot.players[playerId]) {
                this.removeRemotePlayer(playerId);
            }
        }
        
        // 4. Update Cars
        for (const carId in this.game.cars) {
            if (snapshot.cars[carId]) {
                this.game.cars[carId].applySnapshot(snapshot.cars[carId]);
            }
        }
    }
    
    // --- Interpolation ---
    // Runs on the client's main update loop
    interpolateRemoteStates(time) {
        // Calculate the render time (current time - interpolation delay)
        const renderTime = time - INTERPOLATION_DELAY;
        
        // For all remote players
        for (const playerId in this.remotePlayers) {
            const player = this.remotePlayers[playerId];
            
            // Find the two buffered states [p1, p2] that bracket the renderTime
            let p1 = null;
            let p2 = null;
            
            // Note: The player position buffer contains the server snapshots applied in handleSnapshot
            for (let i = 0; i < player.positionBuffer.length - 1; i++) {
                if (player.positionBuffer[i].timestamp <= renderTime && player.positionBuffer[i + 1].timestamp >= renderTime) {
                    p1 = player.positionBuffer[i];
                    p2 = player.positionBuffer[i + 1];
                    break;
                }
            }

            if (p1 && p2) {
                // Calculate interpolation factor
                const range = p2.timestamp - p1.timestamp;
                const factor = (renderTime - p1.timestamp) / range;
                player.updateMesh(factor);
            } else if (player.positionBuffer.length > 0) {
                 // Use the latest state if no bracket found (e.g., still filling the buffer)
                 player.updateMesh(0);
            }
        }
        
        // Interpolate cars (simpler: use the two newest states in buffer)
        for (const carId in this.game.cars) {
            const car = this.game.cars[carId];
            if (car.driverId && car.positionBuffer.length >= 2) {
                car.updateMesh(time / 1000 % 1); // Simple linear interpolation factor
            }
        }
    }

    // --- Client-to-Server Communication ---
    sendInput(input, deltaTime) {
        if (!this.socket || !this.socket.connected) return;
        
        this.inputSequence++;
        
        const inputPacket = {
            ...input,
            sequence: this.inputSequence,
            deltaTime: deltaTime
        };
        
        // Queue the input for reconciliation later
        this.pendingInputs.push(inputPacket);

        // Send a minimal input packet to the server
        this.socket.emit('clientInput', inputPacket);
    }
    
    sendChatMessage(message) {
        if (message.trim() !== '') {
            this.socket.emit('chatMessage', message);
        }
    }
    
    sendAction(type, data = {}) {
        this.socket.emit('clientAction', { type, data });
    }
}
