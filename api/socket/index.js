const { Server } = require('socket.io');
const http = require('http');

// --- Server Constants ---
const UPDATE_RATE = 30; // 30Hz snapshots
const TICK_RATE_MS = 1000 / UPDATE_RATE;
const MAX_PLAYER_SPEED = 10.5; // Slightly above client MAX_SPEED for sanity
const MAX_CAR_SPEED = 61;
const ROOM_ID = 'main_city'; // Simple single room

// --- Server Game State (In-Memory) ---
const state = {
    players: {}, // { socketId: { p: {x,y,z}, v: {x,y,z}, y: yaw, h: health, d: isDriving, vId: vehicleId, lastProcessedInput: seq } }
    cars: {
        'car1': {
            id: 'car1',
            p: { x: 50, y: 0.75, z: 50 }, // Position vector
            y: 0, // Yaw
            s: 0, // Speed
            dId: null, // Driver ID
            pInputs: [], // Pending inputs for car physics
            lastProcessedInput: 0 // For car physics inputs
        }
    },
    rooms: {
        [ROOM_ID]: {
            players: new Set(),
            maxPlayers: 10
        }
    }
};

// --- Physics Simulation (Server Authority) ---
function simulatePhysics(deltaTime) {
    // 1. Player Physics (Simplified)
    for (const playerId in state.players) {
        const player = state.players[playerId];
        
        // If driving, skip player physics; car physics handles movement
        if (player.d) continue;

        // Process pending inputs
        while (player.pInputs.length > 0) {
            const input = player.pInputs.shift();
            
            // Re-run player update logic on the server (similar to client's player.update)
            // This is the core of server authority: server runs the physics with client inputs.
            
            // Simplified movement update (server version of client Player.update)
            const speed = MAX_PLAYER_SPEED * (input.shift ? 2 : 1);
            const moveVector = { x: 0, z: 0 };
            
            if (input.forward) moveVector.z -= speed;
            if (input.backward) moveVector.z += speed;
            if (input.left) moveVector.x -= speed;
            if (input.right) moveVector.x += speed;

            // Apply rotation (yaw) to the movement vector (approximation)
            const sinYaw = Math.sin(player.y);
            const cosYaw = Math.cos(player.y);
            const moveX = moveVector.x * cosYaw - moveVector.z * sinYaw;
            const moveZ = moveVector.x * sinYaw + moveVector.z * cosYaw;

            player.p.x += moveX * deltaTime * 0.1; // Magic factor to match client
            player.p.z += moveZ * deltaTime * 0.1;
            
            // Simple ground/gravity check
            if (player.p.y > 0) player.p.y += -30 * deltaTime; // Gravity
            if (player.p.y < 0) player.p.y = 0;
            
            // Anti-teleport (Sanity Check on Speed)
            const deltaX = player.p.x - player.lastP.x;
            const deltaZ = player.p.z - player.lastP.z;
            const distance = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
            
            if (distance / deltaTime > MAX_PLAYER_SPEED * 2) {
                // Reject input or cap speed to prevent cheating
                console.warn(`Anti-teleport triggered for ${playerId}`);
                player.p.x = player.lastP.x;
                player.p.z = player.lastP.z;
            }
            
            player.lastP.x = player.p.x;
            player.lastP.z = player.p.z;

            // Store the last input sequence processed
            player.lastProcessedInput = input.sequence;
        }
    }
    
    // 2. Car Physics (Only if someone is driving)
    for (const carId in state.cars) {
        const car = state.cars[carId];
        if (!car.dId) continue;
        
        // Find the driver's inputs
        const driver = state.players[car.dId];
        if (!driver) {
             car.dId = null; // Driver disconnected
             continue;
        }
        
        let input = driver.pInputs.shift() || { forward: false, backward: false, left: false, right: false };
        
        // Simplified car movement (similar to client Car.update)
        let gasInput = 0;
        if (input.forward) gasInput = 1;
        if (input.backward) gasInput = -1;
        
        const MAX_ENGINE_FORCE = 15000;
        const CAR_MASS = 1000;
        const CAR_LENGTH = 4.5;
        const MAX_STEER_ANGLE = 0.6;
        
        // Forces and Acceleration
        let totalForce = gasInput * MAX_ENGINE_FORCE;
        const resistance = car.s * 0.5 * car.s * 0.1;
        totalForce -= Math.sign(car.s) * resistance;
        
        const acceleration = totalForce / CAR_MASS;
        car.s += acceleration * deltaTime;
        car.s = Math.min(Math.max(car.s, -MAX_CAR_SPEED), MAX_CAR_SPEED);

        // Steering
        const steerInput = (input.left ? 1 : 0) + (input.right ? -1 : 0);
        const steeringAngle = steerInput * MAX_STEER_ANGLE;
        
        if (Math.abs(car.s) > 0.5) {
            const turnRate = steeringAngle * car.s / CAR_LENGTH * 0.5;
            car.y += turnRate * deltaTime;
        }
        
        // Position Update
        const directionX = Math.sin(car.y);
        const directionZ = Math.cos(car.y);
        
        car.p.x += directionX * car.s * deltaTime;
        car.p.z += directionZ * car.s * deltaTime;
        car.p.y = 0.75; // Ground constraint

        car.lastProcessedInput = input.sequence;
    }
}

// --- Server Loop ---
let lastTick = performance.now();
let ioInstance = null;
let gameLoopInterval = null;

function gameLoop() {
    const now = performance.now();
    const deltaTime = (now - lastTick) / 1000; // Delta time in seconds
    lastTick = now;

    // 1. Simulate authoritative physics
    simulatePhysics(deltaTime);

    // 2. Prepare and broadcast snapshot (State)
    const snapshot = {
        players: {},
        cars: {},
        timestamp: Date.now()
    };
    
    // Prepare player states
    for (const playerId in state.players) {
        const player = state.players[playerId];
        snapshot.players[playerId] = {
            p: player.p,
            y: player.y,
            h: player.h,
            d: player.d,
            vId: player.vId,
            lastProcessedInput: player.lastProcessedInput
        };
    }
    
    // Prepare car states
    for (const carId in state.cars) {
        const car = state.cars[carId];
        snapshot.cars[carId] = {
            p: car.p,
            y: car.y,
            s: car.s,
            dId: car.dId
        };
    }
    
    // Broadcast the game state snapshot to all connected clients
    if (ioInstance) {
        ioInstance.to(ROOM_ID).emit('gameSnapshot', snapshot);
    }
}

// --- Socket.io Handlers ---
function setupHandlers(io) {
    ioInstance = io;
    
    io.on('connection', (socket) => {
        console.log(`User connected: ${socket.id}`);

        // --- 1. Join Room and Init State ---
        socket.join(ROOM_ID);
        state.rooms[ROOM_ID].players.add(socket.id);

        const initialPosition = { x: Math.random() * 50 - 25, y: 0, z: Math.random() * 50 - 25 };
        
        // Create player state on server
        state.players[socket.id] = {
            p: initialPosition,
            lastP: { x: initialPosition.x, z: initialPosition.z }, // For anti-teleport check
            v: { x: 0, y: 0, z: 0 },
            y: 0,
            h: 100,
            d: false, // isDriving
            vId: null,
            pInputs: [], // Client inputs pending processing
            lastProcessedInput: 0
        };
        
        // Send initial state to the newly connected client
        socket.emit('initialState', {
            player: state.players[socket.id],
            players: state.players,
            cars: state.cars
        });

        // --- 2. Client Input (Movement) ---
        // Receive movement inputs and add them to the pending queue
        socket.on('clientInput', (input) => {
            const player = state.players[socket.id];
            if (player) {
                // Sanity check/Rate-limiting
                if (input.sequence > player.lastProcessedInput + 10) {
                     console.warn(`Input sequence jump detected from ${socket.id}`);
                     // Drop packet or apply aggressive throttling here
                }
                
                player.pInputs.push(input);
            }
        });

        // --- 3. Client Action (Car/Mission/etc.) ---
        socket.on('clientAction', (action) => {
            const player = state.players[socket.id];
            if (!player) return;

            if (action.type === 'enterVehicle') {
                const carId = action.data.vehicleId;
                const car = state.cars[carId];
                if (car && !car.dId) { // Basic lock
                    car.dId = socket.id;
                    player.d = true;
                    player.vId = carId;
                    
                    // Teleport player into car visually
                    player.p.x = car.p.x;
                    player.p.y = car.p.y;
                    player.p.z = car.p.z;
                }
            } else if (action.type === 'exitVehicle') {
                 const car = state.cars[player.vId];
                 if (car && car.dId === socket.id) {
                     car.dId = null;
                     player.d = false;
                     player.vId = null;
                     
                     // Eject player near car
                     player.p.x = car.p.x + 2;
                     player.p.y = 0;
                     player.p.z = car.p.z + 2;
                 }
            } else if (action.type === 'completeMission') {
                io.to(ROOM_ID).emit('missionComplete', { 
                    title: action.data.title, 
                    playerId: socket.id 
                });
            }
        });
        
        // --- 4. Chat Message ---
        socket.on('chatMessage', (message) => {
            // Broadcast to everyone (including sender for confirmation)
            io.to(ROOM_ID).emit('chatMessage', { senderId: socket.id.substring(0, 4), message });
        });
        
        // --- 5. Ping/Latency Check ---
        socket.on('ping', (time) => {
            socket.emit('pong', time);
        });

        // --- 6. Disconnect ---
        socket.on('disconnect', () => {
            console.log(`User disconnected: ${socket.id}`);
            state.rooms[ROOM_ID].players.delete(socket.id);
            
            // Eject player from car if driving
            const player = state.players[socket.id];
            if (player && player.d) {
                const car = state.cars[player.vId];
                if (car) car.dId = null;
            }
            
            // Remove player state
            delete state.players[socket.id];
            
            // Notify other clients about the disconnection (happens implicitly in snapshot, but good practice)
        });
    });
}

// --- Vercel Serverless Function Wrapper ---
let io;

/**
 * Creates and keeps alive a single Socket.io server instance for Vercel.
 * @param {object} req - HTTP request object
 * @param {object} res - HTTP response object
 */
module.exports = async (req, res) => {
    // We only need to set up the HTTP server once for the Vercel instance lifetime
    if (!io) {
        // Create an HTTP server instance (required by socket.io)
        const httpServer = http.createServer((req, res) => {
            // Minimal HTTP response for the endpoint itself
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'Socket.io Server Running' }));
        });
        
        io = new Server(httpServer, {
            cors: {
                origin: '*', // Allow all origins for simplicity
                methods: ['GET', 'POST']
            },
            // Use 'websocket' transport only for Vercel for better performance/reliability
            transports: ['websocket'], 
            pingTimeout: 5000,
            pingInterval: 2000
        });

        setupHandlers(io);
        
        // Only start the game loop once
        if (!gameLoopInterval) {
            gameLoopInterval = setInterval(gameLoop, TICK_RATE_MS);
            console.log(`Game loop started at ${UPDATE_RATE}Hz.`);
        }
        
        // Listen on a port if not running in a Vercel environment (local testing)
        // In Vercel, the internal mechanisms handle the port binding.
        if (!process.env.VERCEL) {
            const PORT = process.env.PORT || 3000;
            httpServer.listen(PORT, () => {
                console.log(`Local Socket.io Server running on port ${PORT}`);
            });
        }
    }

    // This handles the initial HTTP request Vercel sends to the function
    if (res.socket && res.socket.server) {
        // Vercel routes the WS request to the underlying server
        res.socket.server.listeners('request').forEach(listener => {
            listener(req, res);
        });
    } else {
        // Standard non-WS request response
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'Socket.io Server Initialized' }));
    }
};
