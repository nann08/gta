import * as THREE from 'three';
import { createWorld } from './world.js';
import { Networking } from './networking.js';
import { Player } from './player.js';
import { Car } from './car.js';

// --- Game State ---
const game = {
    // Three.js elements
    scene: null,
    renderer: null,
    camera: null,
    
    // Game objects
    localPlayer: null,
    cars: {}, // Stored by ID
    
    // Networking
    networking: null,
    
    // Input
    keys: { w: false, a: false, s: false, d: false, space: false, shift: false, e: false },
    
    // Loop
    lastTime: performance.now(),
    deltaTime: 0,
    
    // Missions
    mission: {
        marker: null,
        active: false,
        title: "The Blue Marker",
        description: "Go to the blue marker (100, 0, 100) to complete the tutorial mission. Press 'E' near the car to drive."
    }
};

// --- Initialization ---
function init() {
    const canvas = document.getElementById('gameCanvas');
    game.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    game.renderer.setSize(window.innerWidth, window.innerHeight);
    game.renderer.shadowMap.enabled = true;
    game.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const { scene } = createWorld(game.renderer);
    game.scene = scene;
    
    game.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
    game.camera.position.set(0, 10, -10);

    // Initialize networking
    game.networking = new Networking(game);
    game.networking.connect();
    
    // Setup initial car (will be updated by initialState later)
    const initialCar = new Car('car1', {x: 50, y: 0, z: 50});
    game.cars[initialCar.id] = initialCar;
    game.scene.add(initialCar.mesh);
    
    // Setup mission marker (Blue Box)
    const markerGeometry = new THREE.BoxGeometry(5, 5, 5);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0x0000ff, transparent: true, opacity: 0.7 });
    game.mission.marker = new THREE.Mesh(markerGeometry, markerMaterial);
    game.mission.marker.position.set(100, 2.5, 100);
    game.scene.add(game.mission.marker);
    
    setupInputListeners();
    setupChat();
    setupMissionUI();
    
    window.addEventListener('resize', onWindowResize, false);
    
    animate();
}

// --- Main Loop ---
function animate(time) {
    requestAnimationFrame(animate);

    game.deltaTime = (time - game.lastTime) / 1000;
    game.lastTime = time;

    // 1. Client-Side Prediction (Local Player/Car)
    if (game.localPlayer) {
        // If driving, use car prediction
        if (game.localPlayer.isDriving) {
            const car = game.cars[game.localPlayer.vehicleId];
            if (car) car.update(game.deltaTime, getCurrentInput());
        } else {
            // Player prediction
            game.localPlayer.update(game.deltaTime, getCurrentInput());
        }
        
        // 2. Send Input to Server
        game.networking.sendInput(getCurrentInput(), game.deltaTime);

        // 3. Update Camera and UI
        updateCamera();
        updateMissionLogic();
        updateHealthUI();
        updateMinimap();
        
        // Update name tag positions (local and remote)
        const allPlayers = [game.localPlayer, ...Object.values(game.networking.remotePlayers)];
        for(const player of allPlayers) {
            player.updateNameTag(game.camera, game.renderer);
        }
    }

    // 4. Remote Interpolation
    game.networking.interpolateRemoteStates(time);
    
    game.renderer.render(game.scene, game.camera);
}

// --- Camera Logic ---
function updateCamera() {
    let targetObject = null;
    let distance = 15;
    let height = 8;
    
    if (game.localPlayer) {
        if (game.localPlayer.isDriving) {
            targetObject = game.cars[game.localPlayer.vehicleId];
            distance = 20;
            height = 10;
        } else {
            targetObject = game.localPlayer;
        }
    }
    
    if (targetObject) {
        const targetPos = targetObject.position;
        const targetYaw = targetObject.yaw || game.localPlayer.yaw;
        
        // Camera position behind the player/car (offset along Z-axis rotated by yaw)
        const offset = new THREE.Vector3(0, height, -distance);
        offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), targetYaw);
        
        const cameraTargetPos = targetPos.clone().add(offset);
        
        // Smooth transition (lerp)
        game.camera.position.lerp(cameraTargetPos, game.deltaTime * 5);
        
        // Look at target (slightly above center)
        const lookAtTarget = targetPos.clone().add(new THREE.Vector3(0, height * 0.2, 0));
        game.camera.lookAt(lookAtTarget);
        
        // Update local player yaw based on camera direction
        if (!game.localPlayer.isDriving) {
            const camDir = new THREE.Vector3();
            game.camera.getWorldDirection(camDir);
            // Project direction onto XZ plane
            camDir.y = 0;
            camDir.normalize();

            // Calculate new yaw (y-rotation) for the player
            game.localPlayer.yaw = Math.atan2(camDir.x, camDir.z) + Math.PI;
        }
    }
}

// --- Input Handling ---
function setupInputListeners() {
    window.addEventListener('keydown', (e) => {
        if (document.getElementById('chat-input') === document.activeElement) return;

        const key = e.key.toLowerCase();
        if (game.keys.hasOwnProperty(key)) {
            game.keys[key] = true;
            e.preventDefault();
        }
        
        // Car Enter/Exit logic (E key)
        if (key === 'e' && game.localPlayer) {
            if (game.localPlayer.isDriving) {
                // Exit car
                game.networking.sendAction('exitVehicle', { vehicleId: game.localPlayer.vehicleId });
            } else {
                // Check if near a car to enter
                for (const carId in game.cars) {
                    if (game.cars[carId].isNear(game.localPlayer)) {
                        game.networking.sendAction('enterVehicle', { vehicleId: carId });
                        break;
                    }
                }
            }
        }
    });

    window.addEventListener('keyup', (e) => {
        const key = e.key.toLowerCase();
        if (game.keys.hasOwnProperty(key)) {
            game.keys[key] = false;
            e.preventDefault();
        }
    });
}

function getCurrentInput() {
    return {
        forward: game.keys.w,
        backward: game.keys.s,
        left: game.keys.a,
        right: game.keys.d,
        jump: game.keys.space,
        shift: game.keys.shift
    };
}

// --- Chat Functions ---
function setupChat() {
    const chatInput = document.getElementById('chat-input');
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            game.networking.sendChatMessage(chatInput.value);
            game.addChatMessage('YOU', chatInput.value);
            chatInput.value = '';
        }
    });
}

game.addChatMessage = function(senderId, message) {
    const messages = document.getElementById('chat-messages');
    const li = document.createElement('li');
    li.innerHTML = `<strong>${senderId}:</strong> ${message}`;
    messages.appendChild(li);
    messages.scrollTop = messages.scrollHeight;
};

// --- UI Updates ---
function onWindowResize() {
    game.camera.aspect = window.innerWidth / window.innerHeight;
    game.camera.updateProjectionMatrix();
    game.renderer.setSize(window.innerWidth, window.innerHeight);
}

function updateHealthUI() {
    // Placeholder health, since the server doesn't track it yet.
    const health = 100; 
    const fill = document.getElementById('health-bar-fill');
    fill.style.width = `${health}%`;
    
    // Server snapshot will eventually contain health and drive this.
    // If(game.localPlayer) fill.style.width = `${game.localPlayer.health}%`;
}

// --- Minimap ---
const minimapCanvas = document.getElementById('minimap-canvas');
const minimapCtx = minimapCanvas.getContext('2d');
const minimapScale = 5; // Pixels per unit meter

function updateMinimap() {
    if (!game.localPlayer) return;
    
    const size = minimapCanvas.width;
    const center = size / 2;
    minimapCtx.clearRect(0, 0, size, size);
    
    // Center point (Local Player/Car)
    let targetPos = game.localPlayer.isDriving ? game.cars[game.localPlayer.vehicleId].position : game.localPlayer.position;

    // 1. Draw Ground (Circular)
    minimapCtx.beginPath();
    minimapCtx.arc(center, center, center, 0, 2 * Math.PI);
    minimapCtx.fillStyle = 'rgba(0, 100, 0, 0.8)';
    minimapCtx.fill();
    minimapCtx.clip();

    // 2. Draw Remote Players
    for (const playerId in game.networking.remotePlayers) {
        const remotePos = game.networking.remotePlayers[playerId].position;
        const dx = (remotePos.x - targetPos.x) * minimapScale;
        const dz = (remotePos.z - targetPos.z) * minimapScale;

        if (Math.abs(dx) < center && Math.abs(dz) < center) {
            minimapCtx.fillStyle = 'red';
            minimapCtx.fillRect(center + dx - 2, center + dz - 2, 4, 4);
        }
    }
    
    // 3. Draw Cars
    for (const carId in game.cars) {
        const carPos = game.cars[carId].position;
        const dx = (carPos.x - targetPos.x) * minimapScale;
        const dz = (carPos.z - targetPos.z) * minimapScale;

        if (Math.abs(dx) < center && Math.abs(dz) < center) {
            minimapCtx.fillStyle = game.cars[carId].driverId ? 'gray' : 'yellow';
            minimapCtx.fillRect(center + dx - 3, center + dz - 3, 6, 6);
        }
    }

    // 4. Draw Mission Marker
    const missionPos = game.mission.marker.position;
    const mdx = (missionPos.x - targetPos.x) * minimapScale;
    const mdz = (missionPos.z - targetPos.z) * minimapScale;
    if (Math.abs(mdx) < center && Math.abs(mdz) < center) {
        minimapCtx.fillStyle = 'blue';
        minimapCtx.fillRect(center + mdx - 4, center + mdz - 4, 8, 8);
    }
    
    // 5. Draw Local Player (Center)
    minimapCtx.beginPath();
    minimapCtx.arc(center, center, 4, 0, 2 * Math.PI);
    minimapCtx.fillStyle = 'green';
    minimapCtx.fill();
    
    // Draw direction indicator
    const yaw = game.localPlayer.isDriving ? game.cars[game.localPlayer.vehicleId].yaw : game.localPlayer.yaw;
    const dirX = Math.sin(yaw) * 10;
    const dirY = Math.cos(yaw) * 10;
    minimapCtx.strokeStyle = 'white';
    minimapCtx.lineWidth = 2;
    minimapCtx.beginPath();
    minimapCtx.moveTo(center, center);
    minimapCtx.lineTo(center + dirX, center - dirY);
    minimapCtx.stroke();
    
    // Reset clip path
    minimapCtx.restore(); 
}

// --- Mission Logic ---
function setupMissionUI() {
    const missionPanel = document.getElementById('mission-panel');
    const missionTitle = document.getElementById('mission-title');
    const missionDesc = document.getElementById('mission-description');
    const missionAccept = document.getElementById('mission-accept');
    
    missionTitle.textContent = game.mission.title;
    missionDesc.textContent = game.mission.description;
    
    // Display initial mission popup
    missionPanel.classList.remove('hidden');

    missionAccept.onclick = () => {
        game.mission.active = true;
        missionPanel.classList.add('hidden');
    };
}

function updateMissionLogic() {
    if (!game.mission.active || !game.localPlayer) return;

    let targetPos = game.localPlayer.position;
    if (game.localPlayer.isDriving) {
        targetPos = game.cars[game.localPlayer.vehicleId].position;
    }

    const distance = targetPos.distanceTo(game.mission.marker.position);

    // If player/car is near the marker
    if (distance < 10) {
        game.mission.active = false;
        game.mission.marker.visible = false;
        
        // Broadcast mission completion to server
        game.networking.sendAction('completeMission', { 
            title: game.mission.title, 
            playerId: game.localPlayer.id
        });
        
        // Show completion message (using the standard chat)
        game.addChatMessage('SYSTEM', `Mission Complete: '${game.mission.title}'!`);
    }

    // Simple visual pulse for the marker
    game.mission.marker.scale.setScalar(1 + Math.sin(game.lastTime / 200) * 0.2);
}

window.onload = init;
