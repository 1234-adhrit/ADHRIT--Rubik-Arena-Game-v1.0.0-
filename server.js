const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}


server.listen(PORT, () => {
  console.log(`Rubiks server running on http://localhost:${PORT}`);
});

const rooms = new Map();

const FACE_AXES = {
  F: { axis: 'z', sign: 1, layer: 'z', value: 1 },
  B: { axis: 'z', sign: -1, layer: 'z', value: -1 },
  R: { axis: 'x', sign: 1, layer: 'x', value: 1 },
  L: { axis: 'x', sign: -1, layer: 'x', value: -1 },
  U: { axis: 'y', sign: -1, layer: 'y', value: -1 },
  D: { axis: 'y', sign: 1, layer: 'y', value: 1 },
};

function identity() {
  return [
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ];
}

function matMul(a, b) {
  const r = new Array(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      r[row * 3 + col] =
        a[row * 3 + 0] * b[0 * 3 + col] +
        a[row * 3 + 1] * b[1 * 3 + col] +
        a[row * 3 + 2] * b[2 * 3 + col];
    }
  }
  return r;
}

function matVecMul(m, v) {
  return {
    x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
    y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
    z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
  };
}

function rotMat(axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  if (axis === 'x') {
    return [
      1, 0, 0,
      0, c, -s,
      0, s, c,
    ];
  }
  if (axis === 'y') {
    return [
      c, 0, s,
      0, 1, 0,
      -s, 0, c,
    ];
  }
  return [
    c, -s, 0,
    s, c, 0,
    0, 0, 1,
  ];
}

function clampNear(value) {
  if (Math.abs(value) < 1e-6) return 0;
  if (Math.abs(value - 1) < 1e-6) return 1;
  if (Math.abs(value + 1) < 1e-6) return -1;
  return value;
}

function clampMatrix(m) {
  return m.map(clampNear);
}

function clampVec(v) {
  return {
    x: Math.round(v.x),
    y: Math.round(v.y),
    z: Math.round(v.z),
  };
}

function createSolvedState() {
  const cubies = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        cubies.push({
          home: { x, y, z },
          pos: { x, y, z },
          ori: identity(),
        });
      }
    }
  }
  return cubies;
}

function isIdentity(m) {
  const id = identity();
  for (let i = 0; i < 9; i++) {
    if (Math.abs(m[i] - id[i]) > 1e-6) return false;
  }
  return true;
}

function isSolved(state) {
  return state.every((cubie) => (
    cubie.pos.x === cubie.home.x &&
    cubie.pos.y === cubie.home.y &&
    cubie.pos.z === cubie.home.z &&
    isIdentity(cubie.ori)
  ));
}

function rotateFace(state, face, dir) {
  const info = FACE_AXES[face];
  if (!info) return;
  const angle = dir * (Math.PI / 2) * info.sign;
  const R = rotMat(info.axis, angle);

  for (const cubie of state) {
    if (cubie.pos[info.layer] === info.value) {
      cubie.pos = clampVec(matVecMul(R, cubie.pos));
      cubie.ori = clampMatrix(matMul(R, cubie.ori));
    }
  }
}

function generateCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function makeUniqueCode() {
  let code = generateCode();
  while (rooms.has(code)) {
    code = generateCode();
  }
  return code;
}

function serializeState(state) {
  return state.map((cubie) => ({
    pos: cubie.pos,
    ori: cubie.ori,
  }));
}

function serializeStates(states) {
  const result = {};
  for (const [playerId, state] of states.entries()) {
    result[playerId] = serializeState(state);
  }
  return result;
}

function buildRoomInfo(room) {
  return {
    code: room.code,
    mode: room.mode,
    name: room.name,
    isPublic: room.isPublic,
    hostId: room.hostId,
    players: room.players.map((p) => ({ id: p.id, name: p.name })),
    spectators: room.spectators.map((s) => ({ id: s.id, name: s.name })),
    running: room.running,
    endTime: room.endTime,
    result: room.result,
    winner: room.winner ? { id: room.winner.id, name: room.winner.name } : null,
    states: serializeStates(room.states),
  };
}

function buildRoomSummary(room) {
  const maxPlayers = room.mode === 'solo' ? 1 : 2;
  const canJoinPlayer = room.mode === 'duo' && !room.running && room.players.length < 2;
  return {
    code: room.code,
    name: room.name,
    mode: room.mode,
    isPublic: room.isPublic,
    hasPassword: Boolean(room.passwordHash),
    players: room.players.map((p) => ({ id: p.id, name: p.name })),
    spectatorsCount: room.spectators.length,
    running: room.running,
    maxPlayers,
    canJoinPlayer,
  };
}

function emitRoomsList(target = io) {
  const roomsList = Array.from(rooms.values())
    .filter((room) => room.isPublic)
    .map(buildRoomSummary)
    .sort((a, b) => {
      if (a.running !== b.running) return a.running ? 1 : -1;
      if (a.canJoinPlayer !== b.canJoinPlayer) return a.canJoinPlayer ? -1 : 1;
      return a.code.localeCompare(b.code);
    });
  target.emit('rooms_list', { rooms: roomsList });
}

function randomScramble(length = 22) {
  const faces = ['U', 'D', 'L', 'R', 'F', 'B'];
  const moves = [];
  let last = null;
  for (let i = 0; i < length; i++) {
    let face = faces[Math.floor(Math.random() * faces.length)];
    while (face === last) {
      face = faces[Math.floor(Math.random() * faces.length)];
    }
    last = face;
    const dir = Math.random() < 0.5 ? 1 : -1;
    moves.push({ face, dir });
  }
  return moves;
}

function getChatFilePath(code) {
  return path.join(DATA_DIR, `chat-${code}.json`);
}

function loadChatHistory(code) {
  const file = getChatFilePath(code);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.messages) ? parsed.messages : [];
  } catch {
    return [];
  }
}

function saveChatHistory(room) {
  if (!room.chatFile) return;
  const payload = {
    code: room.code,
    name: room.name,
    updatedAt: Date.now(),
    messages: room.chat,
  };
  try {
    fs.writeFileSync(room.chatFile, JSON.stringify(payload, null, 2), 'utf8');
  } catch {
    // Ignore file write errors to keep realtime chat running.
  }
}

function hashPassword(password, salt = crypto.randomBytes(8).toString('hex')) {
  const hash = crypto
    .createHash('sha256')
    .update(`${salt}:${password}`)
    .digest('hex');
  return { salt, hash };
}

function verifyPassword(room, password) {
  if (!room.passwordHash) return true;
  if (!password) return false;
  const hash = crypto
    .createHash('sha256')
    .update(`${room.passwordSalt}:${password}`)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(room.passwordHash, 'hex'));
  } catch {
    return false;
  }
}

function createStateForRoom(room) {
  const state = createSolvedState();
  if (room.scrambleMoves && room.scrambleMoves.length) {
    for (const move of room.scrambleMoves) {
      rotateFace(state, move.face, move.dir);
    }
  }
  return state;
}

function startTimer(room) {
  clearInterval(room.timer);
  room.timer = setInterval(() => {
    if (room.result) return;
    const timeLeft = Math.max(0, Math.ceil((room.endTime - Date.now()) / 1000));
    io.to(room.code).emit('timer', { timeLeft });
    if (timeLeft <= 0) {
      endRound(room, { result: 'no_winner' });
    }
  }, 1000);
}

function endRound(room, { result, winnerName = null }) {
  if (room.result && room.result !== 'pending') return;
  room.running = false;
  room.result = result;
  clearInterval(room.timer);
  room.timer = null;
  clearTimeout(room.drawWindowTimeout);
  room.drawWindowTimeout = null;
  room.endTime = null;
  room.drawWindowSec = null;
  room.scrambleMoves = null;
  io.to(room.code).emit('round_end', { result, winnerName });
  io.to(room.code).emit('room_update', buildRoomInfo(room));
  emitRoomsList();
}

function startRound(room) {
  room.running = true;
  room.result = null;
  room.winner = null;
  room.winnerTimeSec = null;
  room.drawWindowSec = null;
  clearTimeout(room.drawWindowTimeout);
  room.drawWindowTimeout = null;
  room.endTime = Date.now() + 5 * 60 * 1000;
  startTimer(room);
  io.to(room.code).emit('room_update', buildRoomInfo(room));
  emitRoomsList();
}

function tryDeclareWin(room, playerState, player) {
  if (!isSolved(playerState)) return;
  const nowSec = Math.floor(Date.now() / 1000);

  if (!room.winner) {
    room.winner = player;
    room.winnerTimeSec = nowSec;
    room.result = 'pending';
    room.drawWindowSec = nowSec;
    room.drawWindowTimeout = setTimeout(() => {
      if (room.result === 'pending') {
        endRound(room, { result: 'win', winnerName: room.winner.name });
      }
    }, 1000);
    return;
  }

  if (room.winner.id !== player.id && room.winnerTimeSec === nowSec) {
    endRound(room, { result: 'draw' });
  }
}

function removeFromList(list, id) {
  const idx = list.findIndex((item) => item.id === id);
  if (idx !== -1) list.splice(idx, 1);
}

io.on('connection', (socket) => {
  socket.on('list_rooms', () => {
    emitRoomsList(socket);
  });

  socket.on('create_room', ({ name, mode, roomName, isPublic, password }) => {
    if (!name) return;
    const cleanName = String(name).trim().slice(0, 20) || 'Player';
    const chosenMode = mode === 'solo' ? 'solo' : 'duo';
    const cleanRoomName = String(roomName || '').trim().slice(0, 32);
    const publicFlag = isPublic !== false;
    const cleanPassword = String(password || '').trim();
    const passwordData = cleanPassword ? hashPassword(cleanPassword) : null;
    const code = makeUniqueCode();
    const chatFile = getChatFilePath(code);
    const chatHistory = loadChatHistory(code);
    const room = {
      code,
      name: cleanRoomName || `${cleanName}'s Room`,
      isPublic: publicFlag,
      passwordHash: passwordData ? passwordData.hash : null,
      passwordSalt: passwordData ? passwordData.salt : null,
      mode: chosenMode,
      hostId: socket.id,
      players: [{ id: socket.id, name: cleanName }],
      spectators: [],
      states: new Map([[socket.id, createSolvedState()]]),
      chat: chatHistory,
      chatFile,
      running: false,
      endTime: null,
      timer: null,
      result: null,
      winner: null,
      winnerTimeSec: null,
      drawWindowSec: null,
      drawWindowTimeout: null,
      scrambleMoves: null,
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = 'host';
    socket.data.name = cleanName;
    socket.emit('room_joined', {
      role: 'host',
      info: buildRoomInfo(room),
    });
    socket.emit('chat_history', { messages: room.chat });
    io.to(code).emit('room_update', buildRoomInfo(room));
    emitRoomsList();
  });

  socket.on('join_room', ({ name, code, role: requestedRole, password }) => {
    const room = rooms.get(String(code).trim().toUpperCase());
    if (!room) {
      socket.emit('join_error', { message: 'Room not found.' });
      return;
    }
    const cleanName = String(name).trim().slice(0, 20) || 'Player';
    const wantsSpectator = String(requestedRole || '').toLowerCase() === 'spectator';

    if (!verifyPassword(room, String(password || '').trim())) {
      socket.emit('join_error', { message: 'Incorrect room password.' });
      return;
    }
    let role = 'spectator';

    if (wantsSpectator) {
      room.spectators.push({ id: socket.id, name: cleanName });
    } else if (room.running) {
      room.spectators.push({ id: socket.id, name: cleanName });
    } else if (room.players.length === 0) {
      role = 'host';
      room.hostId = socket.id;
      room.players.push({ id: socket.id, name: cleanName });
    } else if (room.mode === 'duo' && room.players.length < 2) {
      role = 'player';
      room.players.push({ id: socket.id, name: cleanName });
    } else {
      room.spectators.push({ id: socket.id, name: cleanName });
    }

    if (role === 'host' || role === 'player') {
      room.states.set(socket.id, createStateForRoom(room));
    }

    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.role = role;
    socket.data.name = cleanName;

    socket.emit('room_joined', {
      role,
      info: buildRoomInfo(room),
    });
    socket.emit('chat_history', { messages: room.chat });
    io.to(room.code).emit('room_update', buildRoomInfo(room));
    emitRoomsList();
  });

  socket.on('request_scramble', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    if (room.hostId !== socket.id) return;

    const canStart = room.mode === 'solo' || room.players.length === 2;
    if (!canStart || room.running) return;

    const moves = randomScramble();
    room.scrambleMoves = moves;
    for (const player of room.players) {
      const state = createSolvedState();
      for (const move of moves) {
        rotateFace(state, move.face, move.dir);
      }
      room.states.set(player.id, state);
    }

    io.to(room.code).emit('scramble', { moves });
    startRound(room);
    emitRoomsList();
  });

  socket.on('player_move', ({ face, dir }) => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    const isPlayer = room.players.some((p) => p.id === socket.id);
    if (!isPlayer) return;

    const moveFace = String(face || '').toUpperCase();
    const moveDir = Number(dir) === -1 ? -1 : 1;
    if (!FACE_AXES[moveFace]) return;

    if (room.result === 'pending') {
      const nowSec = Math.floor(Date.now() / 1000);
      if (room.winner && room.winner.id !== socket.id && room.winnerTimeSec === nowSec) {
        endRound(room, { result: 'draw' });
      }
      return;
    }

    if (!room.running) {
      return;
    }

    const playerState = room.states.get(socket.id);
    if (!playerState) return;
    rotateFace(playerState, moveFace, moveDir);
    io.to(room.code).emit('move', {
      face: moveFace,
      dir: moveDir,
      playerId: socket.id,
      by: { id: socket.id, name: socket.data.name },
    });

    tryDeclareWin(room, playerState, { id: socket.id, name: socket.data.name });
  });

  socket.on('chat_message', ({ text }) => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    const cleanText = String(text || '').trim();
    if (!cleanText) return;
    const clipped = cleanText.slice(0, 200);
    const role = socket.data.role || 'spectator';
    const rawName = socket.data.name || 'Player';
    const displayName = role === 'spectator' ? `${rawName} (spectator)` : rawName;
    const message = {
      id: crypto.randomBytes(6).toString('hex'),
      name: displayName,
      text: clipped,
      time: Date.now(),
    };
    room.chat.push(message);
    if (room.chat.length > 100) {
      room.chat.splice(0, room.chat.length - 100);
    }
    saveChatHistory(room);
    io.to(room.code).emit('chat_message', message);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    removeFromList(room.players, socket.id);
    removeFromList(room.spectators, socket.id);
    room.states.delete(socket.id);

    if (room.hostId === socket.id) {
      if (room.players.length > 0) {
        room.hostId = room.players[0].id;
      } else if (room.spectators.length > 0) {
        const next = room.spectators.shift();
        room.players.push(next);
        room.hostId = next.id;
        room.states.set(next.id, createStateForRoom(room));
        const promotedSocket = io.sockets.sockets.get(next.id);
        if (promotedSocket) {
          promotedSocket.data.role = 'player';
        }
        io.to(next.id).emit('promoted_to_player');
      }
    }

    if (room.players.length === 0 && room.spectators.length === 0) {
      clearInterval(room.timer);
      clearTimeout(room.drawWindowTimeout);
      rooms.delete(code);
      emitRoomsList();
      return;
    }

    io.to(room.code).emit('room_update', buildRoomInfo(room));
    emitRoomsList();
  });
});



