import * as THREE from 'three';

// --- World Constants ---
const ROAD_COLOR = 0x333333;
const GROUND_COLOR = 0x228B22; // Forest Green
const BUILDING_COLOR = 0xCCCCCC;

// Scene objects storage
const sceneObjects = {};

// --- City Generation ---
function createBuilding(x, z, width, depth, height) {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const material = new THREE.MeshLambertMaterial({ color: BUILDING_COLOR, transparent: true, opacity: 0.95 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

function createRoad(x, z, width, depth) {
    const geometry = new THREE.BoxGeometry(width, 0.1, depth);
    const material = new THREE.MeshLambertMaterial({ color: ROAD_COLOR });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, 0.05, z);
    mesh.receiveShadow = true;
    return mesh;
}

function generateSimpleCity(scene) {
    const size = 1000;
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshStandardMaterial({ color: GROUND_COLOR })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    sceneObjects.ground = ground;

    // A simple grid of roads and buildings (Manhattan-style)
    const gridSize = 10;
    const blockSize = 80;
    const roadWidth = 10;
    const halfSize = gridSize * (blockSize + roadWidth) / 2;

    for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
            const x = i * (blockSize + roadWidth) + blockSize / 2 - halfSize;
            const z = j * (blockSize + roadWidth) + blockSize / 2 - halfSize;

            // Building
            const height = 10 + Math.random() * 80;
            const building = createBuilding(x, z, blockSize * 0.8, blockSize * 0.8, height);
            scene.add(building);

            // Roads (Vertical)
            if (i < gridSize - 1) {
                const roadV = createRoad(x + blockSize / 2 + roadWidth / 2, z, roadWidth, blockSize);
                scene.add(roadV);
            }
            // Roads (Horizontal)
            if (j < gridSize - 1) {
                const roadH = createRoad(x, z + blockSize / 2 + roadWidth / 2, blockSize, roadWidth);
                scene.add(roadH);
            }
        }
    }

    // Central crossroad
    scene.add(createRoad(0, 0, roadWidth, size));
    scene.add(createRoad(0, 0, size, roadWidth));
}

// --- Lights and Skybox (Basic) ---
function setupLighting(scene) {
    // Ambient light for general illumination
    const ambientLight = new THREE.AmbientLight(0x404040, 0.8);
    scene.add(ambientLight);

    // Directional light (Sun) for shadows
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
    sunLight.position.set(500, 800, 300);
    sunLight.castShadow = true;
    
    // Shadow map settings (performance optimization needed for production)
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 2000;
    sunLight.shadow.camera.left = -500;
    sunLight.shadow.camera.right = 500;
    sunLight.shadow.camera.top = 500;
    sunLight.shadow.camera.bottom = -500;

    scene.add(sunLight);
    sceneObjects.sunLight = sunLight;
}

// --- World Initialization ---
export function createWorld(renderer) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Sky color

    generateSimpleCity(scene);
    setupLighting(scene);

    return { scene, sceneObjects };
}
