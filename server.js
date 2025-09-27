const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { nanoid } = require('nanoid');

const app = express();
const server = http.createServer(app);

// Configuración de CORS más explícita
const io = new Server(server, {
  cors: {
    origin: "*", // Permite conexiones desde cualquier origen
    methods: ["GET", "POST"]
  }
});

const rooms = {};
const gridSize = 20;

io.on('connection', (socket) => {
  console.log(`[CONEXIÓN] Usuario conectado: ${socket.id}`);

  socket.on('createRoom', (data) => {
    if (!data || typeof data.playerName === 'undefined') {
      console.log(`[ERROR] Intento de crear sala con datos inválidos desde ${socket.id}`);
      return;
    }
    
    const playerName = data.playerName;
    // CORRECCIÓN CLAVE: El código de la sala se genera en mayúsculas.
    const roomId = nanoid(5).toUpperCase(); 
    
    rooms[roomId] = {
      players: {},
      apple: generateApple(),
      gameState: 'waiting',
      host: socket.id
    };
    
    rooms[roomId].players[socket.id] = createPlayer(socket.id, playerName);
    socket.join(roomId);
    
    console.log(`[SALA CREADA] Jugador "${playerName}" (${socket.id}) ha creado la sala: ${roomId}`);
    
    socket.emit('roomCreated', { roomId, players: rooms[roomId].players, hostId: rooms[roomId].host });
  });

  socket.on('joinRoom', (data) => {
    if (!data || !data.playerName || !data.roomId) {
      console.log(`[ERROR] Intento de unirse a sala con datos incompletos desde ${socket.id}`);
      return;
    }

    // El cliente ya envía el roomId en mayúsculas, así que la comparación funcionará.
    const { roomId, playerName } = data; 
    const room = rooms[roomId];

    if (room) {
      if (room.gameState === 'playing') {
        socket.emit('error', 'La partida ya ha comenzado.');
        return;
      }
      socket.join(roomId);
      room.players[socket.id] = createPlayer(socket.id, playerName);
      console.log(`[UNIÓN A SALA] Jugador "${playerName}" (${socket.id}) se unió a la sala: ${roomId}`);
      io.to(roomId).emit('updatePlayers', { players: room.players, hostId: room.host });
    } else {
      console.log(`[ERROR DE UNIÓN] Jugador "${playerName}" intentó unirse a sala inexistente: ${roomId}`);
      socket.emit('error', 'La sala no existe.');
    }
  });
  
  socket.on('startGame', (roomId) => {
    const room = rooms[roomId];
    if (room && room.host === socket.id) {
        console.log(`[PARTIDA INICIADA] La partida en la sala ${roomId} ha comenzado.`);
        room.gameState = 'playing';
        io.to(roomId).emit('gameStarted', room);
        startGameInterval(roomId);
    }
  });

  socket.on('directionChange', (data) => {
    const { roomId, direction } = data;
    const room = rooms[roomId];
    if (room && room.players[socket.id]) {
        const player = room.players[socket.id];
        const { dx, dy } = player;
        if (direction === 'up' && dy === 0) { player.dx = 0; player.dy = -gridSize; }
        else if (direction === 'down' && dy === 0) { player.dx = 0; player.dy = gridSize; }
        else if (direction === 'left' && dx === 0) { player.dx = -gridSize; player.dy = 0; }
        else if (direction === 'right' && dx === 0) { player.dx = gridSize; player.dy = 0; }
    }
  });

  socket.on('disconnect', () => {
    console.log(`[DESCONEXIÓN] Usuario desconectado: ${socket.id}`);
    for (const roomId in rooms) {
      if (rooms[roomId].players[socket.id]) {
        const playerName = rooms[roomId].players[socket.id].name;
        console.log(`[JUGADOR ELIMINADO] Jugador "${playerName}" eliminado de la sala ${roomId}`);
        delete rooms[roomId].players[socket.id];
        
        if (rooms[roomId].host === socket.id) {
            console.log(`[HOST DESCONECTADO] El host ha salido. Cerrando sala ${roomId}.`);
            io.to(roomId).emit('error', 'El host se ha desconectado. Fin de la partida.');
            delete rooms[roomId];
        } else {
            io.to(roomId).emit('updatePlayers', { players: rooms[roomId].players, hostId: rooms[roomId].host });
        }
        return; 
      }
    }
  });
});

function createPlayer(id, name) {
    const safeName = (name || 'Anónimo').trim().slice(0, 12);
    return { id, name: safeName, body: [{ x: Math.floor(Math.random() * 30) * gridSize, y: Math.floor(Math.random() * 30) * gridSize }], dx: 0, dy: 0, score: 0, color: `hsl(${Math.random() * 360}, 90%, 70%)`};
}

function generateApple() {
    return { x: Math.floor(Math.random() * 30) * gridSize, y: Math.floor(Math.random() * 30) * gridSize };
}

function updateGameState(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    const playersToDelete = [];
    for (const id in room.players) {
        const player = room.players[id];
        if (player.dx === 0 && player.dy === 0) continue; 
        
        const head = { x: player.body[0].x + player.dx, y: player.body[0].y + player.dy };
        player.body.unshift(head);
        
        const dist = Math.sqrt(Math.pow(head.x - room.apple.x, 2) + Math.pow(head.y - room.apple.y, 2));
        if (dist < gridSize) {
            player.score++;
            room.apple = generateApple();
        } else {
            player.body.pop();
        }
        
        if (checkCollision(head, id, room.players)) {
            playersToDelete.push(id);
        }
    }
    playersToDelete.forEach(id => {
        if(room.players[id]) { 
            console.log(`[JUGADOR ELIMINADO] Jugador "${room.players[id].name}" ha chocado.`);
            delete room.players[id];
            io.to(roomId).emit('playerEliminated', { playerId: id, remainingPlayers: room.players });
        }
    });
}

function checkCollision(head, playerId, players) {
    if (head.x < 0 || head.x >= 600 || head.y < 0 || head.y >= 600) return true;
    
    for (const id in players) {
        for (let i = 0; i < players[id].body.length; i++) {
            if (id === playerId && i === 0) continue;
            if (head.x === players[id].body[i].x && head.y === players[id].body[i].y) return true;
        }
    }
    return false;
}

function startGameInterval(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    
    if(room.players[room.host]) {
        room.players[room.host].dx = gridSize;
    }

    const intervalId = setInterval(() => {
        const currentRoom = rooms[roomId];
        if (!currentRoom || Object.keys(currentRoom.players).length === 0) {
            console.log(`[FIN DE PARTIDA] Sala ${roomId} vacía o cerrada. Deteniendo bucle de juego.`);
            clearInterval(intervalId);
            if (!currentRoom) delete rooms[roomId];
            return;
        }
        updateGameState(roomId);
        io.to(roomId).emit('gameStateUpdate', currentRoom);
    }, 120);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[SERVIDOR] Escuchando en el puerto ${PORT}`));