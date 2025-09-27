const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { nanoid } = require('nanoid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // En producción, deberías cambiar esto a la URL de tu Netlify
    methods: ["GET", "POST"]
  }
});

const rooms = {};
const gridSize = 20;

io.on('connection', (socket) => {
  console.log('Un usuario se ha conectado:', socket.id);

  // El host crea una nueva sala
  socket.on('createRoom', () => {
    const roomId = nanoid(5); // Genera un código de 5 caracteres
    rooms[roomId] = {
      players: {},
      apple: generateApple(),
      gameState: 'waiting', // Estados: waiting, playing
      host: socket.id
    };
    socket.join(roomId);
    rooms[roomId].players[socket.id] = createPlayer(socket.id);
    socket.emit('roomCreated', { roomId, players: rooms[roomId].players, hostId: rooms[roomId].host });
  });

  // Un jugador se une a una sala existente
  socket.on('joinRoom', (roomId) => {
    if (rooms[roomId]) {
      if (rooms[roomId].gameState === 'playing') {
        socket.emit('error', 'La partida ya ha comenzado.');
        return;
      }
      socket.join(roomId);
      rooms[roomId].players[socket.id] = createPlayer(socket.id);
      io.to(roomId).emit('updatePlayers', { players: rooms[roomId].players, hostId: rooms[roomId].host });
    } else {
      socket.emit('error', 'La sala no existe.');
    }
  });
  
  // El host inicia la partida
  socket.on('startGame', (roomId) => {
      if (rooms[roomId] && rooms[roomId].host === socket.id) {
          rooms[roomId].gameState = 'playing';
          io.to(roomId).emit('gameStarted', rooms[roomId]);
          startGameInterval(roomId);
      }
  });

  // Un jugador actualiza su dirección
  socket.on('directionChange', (data) => {
    const { roomId, direction } = data;
    if (rooms[roomId] && rooms[roomId].players[socket.id]) {
        const player = rooms[roomId].players[socket.id];
        const { dx, dy } = player;

        if (direction === 'up' && dy === 0) { player.dx = 0; player.dy = -gridSize; }
        if (direction === 'down' && dy === 0) { player.dx = 0; player.dy = gridSize; }
        if (direction === 'left' && dx === 0) { player.dx = -gridSize; player.dy = 0; }
        if (direction === 'right' && dx === 0) { player.dx = gridSize; player.dy = 0; }
    }
  });

  socket.on('disconnect', () => {
    console.log('Un usuario se ha desconectado:', socket.id);
    for (const roomId in rooms) {
      if (rooms[roomId].players[socket.id]) {
        delete rooms[roomId].players[socket.id];
        // Si el host se desconecta, se podría eliminar la sala
        if (rooms[roomId].host === socket.id) {
            io.to(roomId).emit('error', 'El host se ha desconectado. Fin de la partida.');
            delete rooms[roomId];
        } else {
            io.to(roomId).emit('updatePlayers', { players: rooms[roomId].players, hostId: rooms[roomId].host });
        }
        break;
      }
    }
  });
});

function createPlayer(id) {
    return {
        id: id,
        body: [{ x: Math.floor(Math.random() * 30) * gridSize, y: Math.floor(Math.random() * 30) * gridSize }],
        dx: gridSize,
        dy: 0,
        score: 0,
        color: `hsl(${Math.random() * 360}, 90%, 70%)`
    };
}

function generateApple() {
    return {
        x: Math.floor(Math.random() * 30) * gridSize,
        y: Math.floor(Math.random() * 30) * gridSize,
    };
}

function startGameInterval(roomId) {
    const intervalId = setInterval(() => {
        const room = rooms[roomId];
        if (!room) {
            clearInterval(intervalId);
            return;
        }

        updateGameState(roomId);
        io.to(roomId).emit('gameStateUpdate', { players: room.players, apple: room.apple });

    }, 120);
}

function updateGameState(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    const playersToDelete = [];

    for (const id in room.players) {
        const player = room.players[id];
        const head = { x: player.body[0].x + player.dx, y: player.body[0].y + player.dy };
        player.body.unshift(head);

        // Hitbox de la manzana agrandada (se considera una colisión si la cabeza está a menos de gridSize de distancia)
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
        delete room.players[id];
        io.to(roomId).emit('playerEliminated', { playerId: id, remainingPlayers: room.players });
    });
}

function checkCollision(head, playerId, players) {
    // Colisión con bordes
    if (head.x < 0 || head.x >= 600 || head.y < 0 || head.y >= 600) {
        return true;
    }
    // Colisión con otros jugadores
    for (const id in players) {
        for (let i = 0; i < players[id].body.length; i++) {
            if (id === playerId && i === 0) continue;
            if (head.x === players[id].body[i].x && head.y === players[id].body[i].y) {
                return true;
            }
        }
    }
    return false;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});