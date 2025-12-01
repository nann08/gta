import * as THREE from 'three';

// Function to create a simple visual representation of a player (the car)
export function createPlayerModel(color = 0xff0000) {
    const geometry = new THREE.BoxGeometry(4, 1, 8); // Car-like dimensions
    const material = new THREE.MeshLambertMaterial({ color: color });
    const mesh = new THREE.Mesh(geometry, material);
    
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    
    // Simple car hood (to indicate front)
    const hoodGeometry = new THREE.BoxGeometry(3, 0.5, 2);
    const hoodMaterial = new THREE.MeshLambertMaterial({ color: 0xAAAAAA });
    const hoodMesh = new THREE.Mesh(hoodGeometry, hoodMaterial);
    hoodMesh.position.set(0, 0.75, 4); 
    mesh.add(hoodMesh);

    return mesh;
}

// Function to remove a player model from the scene
export function destroyPlayerModel(scene, mesh) {
    if (mesh) {
        scene.remove(mesh);
        // Dispose of geometry and material to free up memory
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => m.dispose());
            } else {
                mesh.material.dispose();
            }
        }
    }
}
