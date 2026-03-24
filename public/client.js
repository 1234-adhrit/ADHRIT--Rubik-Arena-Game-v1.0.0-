const socket = io();

const arenaEl = document.getElementById('arena');
const lobbyEl = document.getElementById('lobby');
const roomEl = document.getElementById('room');
const nameInput = document.getElementById('nameInput');
const roomNameInput = document.getElementById('roomNameInput');
const publicToggle = document.getElementById('publicToggle');
const roomPasswordInput = document.getElementById('roomPasswordInput');
const codeInput = document.getElementById('codeInput');
const joinPasswordInput = document.getElementById('joinPasswordInput');
const lobbyError = document.getElementById('lobbyError');
const createDuoBtn = document.getElementById('createDuo');
const createSoloBtn = document.getElementById('createSolo');
const joinBtn = document.getElementById('joinBtn');
const spectateBtn = document.getElementById('spectateBtn');
const roomBoardEl = document.getElementById('roomBoard');
const refreshRoomsBtn = document.getElementById('refreshRooms');
const scrambleBtn = document.getElementById('scrambleBtn');
const resetViewBtn = document.getElementById('resetView');
const roomCodeEl = document.getElementById('roomCode');
const roleBadge = document.getElementById('roleBadge');
const statusText = document.getElementById('statusText');
const timerEl = document.getElementById('timer');
const playerListEl = document.getElementById('playerList');
const spectatorListEl = document.getElementById('spectatorList');
const moveControlsEl = document.getElementById('moveControls');
const chatEl = document.getElementById('chat');
const chatHeaderEl = document.getElementById('chatHeader');
const chatMessagesEl = document.getElementById('chatMessages');
const chatTextEl = document.getElementById('chatText');
const chatSendBtn = document.getElementById('chatSend');

const SIZE = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--size'));
const GAP = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gap'));
const STEP = SIZE + GAP;

const COLORS = {
  front: '#00a651',
  back: '#0051ba',
  right: '#c41e3a',
  left: '#ff5800',
  up: '#f4f4f4',
  down: '#ffd500',
  inner: '#101218',
};

const faceDefs = [
  { name: 'front', className: 'front' },
  { name: 'back', className: 'back' },
  { name: 'right', className: 'right' },
  { name: 'left', className: 'left' },
  { name: 'up', className: 'up' },
  { name: 'down', className: 'down' },
];

const FACE_AXES = {
  F: { axis: 'z', sign: 1, layer: 'z', value: 1 },
  B: { axis: 'z', sign: -1, layer: 'z', value: -1 },
  R: { axis: 'x', sign: 1, layer: 'x', value: 1 },
  L: { axis: 'x', sign: -1, layer: 'x', value: -1 },
  U: { axis: 'y', sign: -1, layer: 'y', value: -1 },
  D: { axis: 'y', sign: 1, layer: 'y', value: 1 },
};

const cubeViews = new Map();
let roomInfo = null;
let roomPollTimer = null;
let chatDragging = false;
let chatDragOffsetX = 0;
let chatDragOffsetY = 0;

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

function toMatrix3d(m) {
  return `matrix3d(${[
    m[0], m[3], m[6], 0,
    m[1], m[4], m[7], 0,
    m[2], m[5], m[8], 0,
    0, 0, 0, 1,
  ].join(',')})`;
}

function applyTransform(cubie, pos, ori) {
  const tx = pos.x * STEP;
  const ty = pos.y * STEP;
  const tz = pos.z * STEP;
  cubie.el.style.transform = `translate3d(${tx}px, ${ty}px, ${tz}px) ${toMatrix3d(ori)}`;
}

function createCubie(x, y, z, cubeEl, cubies) {
  const el = document.createElement('div');
  el.className = 'cubie';

  for (const face of faceDefs) {
    const faceEl = document.createElement('div');
    faceEl.className = `face ${face.className}`;
    let color = COLORS.inner;
    if (face.name === 'front' && z === 1) color = COLORS.front;
    if (face.name === 'back' && z === -1) color = COLORS.back;
    if (face.name === 'right' && x === 1) color = COLORS.right;
    if (face.name === 'left' && x === -1) color = COLORS.left;
    if (face.name === 'up' && y === -1) color = COLORS.up;
    if (face.name === 'down' && y === 1) color = COLORS.down;
    faceEl.style.background = color;
    el.appendChild(faceEl);
  }

  cubeEl.appendChild(el);
  const cubie = { el, pos: { x, y, z }, ori: identity() };
  cubies.push(cubie);
  applyTransform(cubie, cubie.pos, cubie.ori);
}

function buildCube(cubeEl, cubies) {
  cubeEl.innerHTML = '';
  cubies.length = 0;
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        createCubie(x, y, z, cubeEl, cubies);
      }
    }
  }
}

function setState(cubies, state) {
  if (!state || state.length !== cubies.length) return;
  for (let i = 0; i < cubies.length; i++) {
    const data = state[i];
    if (!data) continue;
    cubies[i].pos = { ...data.pos };
    cubies[i].ori = data.ori.slice();
    applyTransform(cubies[i], cubies[i].pos, cubies[i].ori);
  }
}

function animateMove(cubies, face, dir, duration = 260, onDone) {
  const info = FACE_AXES[face];
  if (!info) {
    onDone?.();
    return;
  }
  const layerCubies = cubies.filter((c) => c.pos[info.layer] === info.value);
  const start = layerCubies.map((c) => ({
    cubie: c,
    pos: { ...c.pos },
    ori: c.ori.slice(),
  }));
  const angle = dir * (Math.PI / 2) * info.sign;
  const startTime = performance.now();

  function tick(now) {
    const t = Math.min(1, (now - startTime) / duration);
    const ease = t < 1 ? (1 - Math.cos(t * Math.PI)) / 2 : 1;
    const R = rotMat(info.axis, angle * ease);

    for (const item of start) {
      const posT = matVecMul(R, item.pos);
      const oriT = matMul(R, item.ori);
      applyTransform(item.cubie, posT, oriT);
    }

    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      const R90 = rotMat(info.axis, angle);
      for (const item of start) {
        const posN = clampVec(matVecMul(R90, item.pos));
        const oriN = clampMatrix(matMul(R90, item.ori));
        item.cubie.pos = posN;
        item.cubie.ori = oriN;
        applyTransform(item.cubie, posN, oriN);
      }
      onDone?.();
    }
  }

  requestAnimationFrame(tick);
}

function createCubeView(playerId, name) {
  const card = document.createElement('div');
  card.className = 'cube-card';
  card.dataset.playerId = playerId;

  const title = document.createElement('div');
  title.className = 'cube-title';
  title.textContent = name;
  card.appendChild(title);

  const viewport = document.createElement('div');
  viewport.className = 'viewport';
  const scene = document.createElement('div');
  scene.className = 'scene';
  const cube = document.createElement('div');
  cube.className = 'cube';
  scene.appendChild(cube);
  viewport.appendChild(scene);
  card.appendChild(viewport);

  const cubies = [];
  let moveQueue = [];
  let animating = false;
  let rotX = -25;
  let rotY = 35;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function updateScene() {
    scene.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg)`;
  }

  function enqueueMove(move, duration) {
    moveQueue.push({ ...move, duration });
    if (!animating) playQueue();
  }

  function playQueue() {
    if (moveQueue.length === 0) {
      animating = false;
      return;
    }
    animating = true;
    const next = moveQueue.shift();
    animateMove(cubies, next.face, next.dir, next.duration, () => {
      playQueue();
    });
  }

  function clearQueue() {
    moveQueue = [];
    animating = false;
  }

  function resetView() {
    rotX = -25;
    rotY = 35;
    updateScene();
  }

  viewport.addEventListener('pointerdown', (event) => {
    dragging = true;
    viewport.classList.add('dragging');
    lastX = event.clientX;
    lastY = event.clientY;
    viewport.setPointerCapture(event.pointerId);
  });

  viewport.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    rotY += dx * 0.4;
    rotX -= dy * 0.4;
    rotX = Math.max(-85, Math.min(85, rotX));
    updateScene();
    lastX = event.clientX;
    lastY = event.clientY;
  });

  function stopDrag(event) {
    if (!dragging) return;
    dragging = false;
    viewport.classList.remove('dragging');
    viewport.releasePointerCapture(event.pointerId);
  }

  viewport.addEventListener('pointerup', stopDrag);
  viewport.addEventListener('pointercancel', stopDrag);

  buildCube(cube, cubies);
  updateScene();

  return {
    id: playerId,
    card,
    title,
    cube,
    cubies,
    setTitle(text) {
      title.textContent = text;
    },
    setState(state) {
      if (cubies.length === 0) {
        buildCube(cube, cubies);
      }
      setState(cubies, state);
    },
    build() {
      buildCube(cube, cubies);
    },
    enqueueMove,
    clearQueue,
    resetView,
    isAnimating() {
      return animating;
    },
  };
}

function syncCubeViews(players, states) {
  const activeIds = new Set(players.map((p) => p.id));

  for (const [id, view] of cubeViews.entries()) {
    if (!activeIds.has(id)) {
      view.card.remove();
      cubeViews.delete(id);
    }
  }

  players.forEach((player) => {
    let view = cubeViews.get(player.id);
    if (!view) {
      view = createCubeView(player.id, player.name);
      cubeViews.set(player.id, view);
      arenaEl.appendChild(view.card);
      if (states && states[player.id]) {
        view.setState(states[player.id]);
      }
    }
    const label = player.id === socket.id ? `${player.name} (You)` : player.name;
    view.setTitle(label);
  });
}

function updateTimer(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function showRoom() {
  lobbyEl.classList.add('hidden');
  roomEl.classList.remove('hidden');
}

function showChat() {
  chatEl.classList.remove('hidden');
}

function hideChat() {
  chatEl.classList.add('hidden');
}

function setLobbyMessage(message) {
  lobbyError.textContent = message || '';
}

function renderList(el, items) {
  el.innerHTML = '';
  if (!items || items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'item';
    empty.textContent = 'None';
    el.appendChild(empty);
    return;
  }
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'item';
    row.textContent = item.name;
    el.appendChild(row);
  });
}

function renderRoomBoard(rooms) {
  roomBoardEl.innerHTML = '';
  if (!rooms || rooms.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'room-meta';
    empty.textContent = 'No open rooms yet.';
    roomBoardEl.appendChild(empty);
    return;
  }

  rooms.forEach((room) => {
    const card = document.createElement('div');
    card.className = 'room-card';

    const headerRow = document.createElement('div');
    headerRow.className = 'room-header-row';

    const title = document.createElement('div');
    title.className = 'room-title';
    title.textContent = room.name || room.code;

    const badges = document.createElement('div');
    badges.className = 'room-badges';

    const capacity = document.createElement('div');
    capacity.className = 'badge-small';
    capacity.textContent = `${room.players.length}/${room.maxPlayers}`;
    badges.appendChild(capacity);

    if (room.hasPassword) {
      const lock = document.createElement('div');
      lock.className = 'badge-small badge-lock';
      lock.textContent = 'Locked';
      badges.appendChild(lock);
    }

    headerRow.appendChild(title);
    headerRow.appendChild(badges);

    const code = document.createElement('div');
    code.className = 'room-code';
    code.textContent = room.code;

    const meta = document.createElement('div');
    meta.className = 'room-meta';
    const modeLabel = room.mode === 'solo' ? 'Solo' : 'Duo';
    const status = room.running ? 'Running' : 'Waiting';
    meta.textContent = `${modeLabel} • Players ${room.players.length}/${room.maxPlayers} • Spectators ${room.spectatorsCount} • ${status}`;

    const actions = document.createElement('div');
    actions.className = 'room-actions';

    const joinPlayerBtn = document.createElement('button');
    joinPlayerBtn.textContent = 'Join Player';
    joinPlayerBtn.disabled = !room.canJoinPlayer;
    joinPlayerBtn.addEventListener('click', () => {
      joinRoomWithRole(room.code, 'player', room.hasPassword);
    });

    const joinSpectatorBtn = document.createElement('button');
    joinSpectatorBtn.textContent = 'Watch';
    joinSpectatorBtn.addEventListener('click', () => {
      joinRoomWithRole(room.code, 'spectator', room.hasPassword);
    });

    actions.appendChild(joinPlayerBtn);
    actions.appendChild(joinSpectatorBtn);

    card.appendChild(headerRow);
    card.appendChild(code);
    card.appendChild(meta);
    card.appendChild(actions);
    roomBoardEl.appendChild(card);
  });
}

function appendChatMessage(message) {
  const item = document.createElement('div');
  item.className = 'chat-message';

  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = message.name;

  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = message.text;

  const meta = document.createElement('div');
  meta.className = 'meta';
  const time = new Date(message.time || Date.now());
  meta.textContent = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  item.appendChild(name);
  item.appendChild(text);
  item.appendChild(meta);
  chatMessagesEl.appendChild(item);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function setChatHistory(messages) {
  chatMessagesEl.innerHTML = '';
  (messages || []).forEach(appendChatMessage);
}

function updateRoomUI(info) {
  roomInfo = info;
  if (!info) return;
  showRoom();
  showChat();
  roomCodeEl.textContent = info.code;

  const isHost = info.hostId === socket.id;
  const isPlayer = info.players.some((p) => p.id === socket.id);
  const role = isHost ? 'HOST' : isPlayer ? 'PLAYER' : 'SPECTATOR';
  roleBadge.textContent = role;

  renderList(playerListEl, info.players);
  renderList(spectatorListEl, info.spectators);

  let status = 'Waiting for players...';
  if (info.result === 'win' && info.winner) {
    status = `Winner: ${info.winner.name}`;
  } else if (info.result === 'draw') {
    status = 'Draw. Two players solved in the same second.';
  } else if (info.result === 'no_winner') {
    status = 'Time is up. No winner.';
  } else if (info.running) {
    status = 'Solving...';
  } else if (info.mode === 'solo') {
    status = 'Ready. Host can scramble.';
  } else if (info.players.length < 2) {
    status = 'Waiting for player 2...';
  } else {
    status = 'Ready. Host can scramble.';
  }
  statusText.textContent = status;

  const canStart = info.mode === 'solo' || info.players.length === 2;
  scrambleBtn.disabled = !isHost || info.running || !canStart;

  const canControl = isPlayer && info.running && !info.result;
  for (const button of moveControlsEl.querySelectorAll('button')) {
    button.disabled = !canControl;
  }

  if (!info.running && !info.result) {
    updateTimer(300);
  }
}

function getPlayerName() {
  const name = nameInput.value.trim();
  if (!name) {
    setLobbyMessage('Please enter your name.');
    return null;
  }
  setLobbyMessage('');
  return name;
}

function getRoomSettings() {
  const roomName = (roomNameInput?.value || '').trim();
  const isPublic = publicToggle ? publicToggle.checked : true;
  const password = (roomPasswordInput?.value || '').trim();
  return { roomName, isPublic, password };
}

function joinRoomWithRole(code, role, requiresPassword = false) {
  const name = getPlayerName();
  if (!name) return;
  if (!code) {
    setLobbyMessage('Enter a room code to join.');
    return;
  }
  const password = (joinPasswordInput?.value || '').trim();
  if (requiresPassword && !password) {
    setLobbyMessage('This room requires a password.');
    return;
  }
  setLobbyMessage('');
  socket.emit('join_room', { name, code, role, password });
}

createDuoBtn.addEventListener('click', () => {
  const name = getPlayerName();
  if (!name) return;
  const { roomName, isPublic, password } = getRoomSettings();
  socket.emit('create_room', { name, mode: 'duo', roomName, isPublic, password });
});

createSoloBtn.addEventListener('click', () => {
  const name = getPlayerName();
  if (!name) return;
  const { roomName, isPublic, password } = getRoomSettings();
  socket.emit('create_room', { name, mode: 'solo', roomName, isPublic, password });
});

joinBtn.addEventListener('click', () => {
  const code = codeInput.value.trim().toUpperCase();
  joinRoomWithRole(code, 'player');
});

spectateBtn.addEventListener('click', () => {
  const code = codeInput.value.trim().toUpperCase();
  joinRoomWithRole(code, 'spectator');
});

refreshRoomsBtn.addEventListener('click', () => {
  socket.emit('list_rooms');
});

scrambleBtn.addEventListener('click', () => {
  socket.emit('request_scramble');
});

moveControlsEl.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  socket.emit('player_move', {
    face: button.dataset.face,
    dir: Number(button.dataset.dir),
  });
});

resetViewBtn.addEventListener('click', () => {
  cubeViews.forEach((view) => view.resetView());
});

function sendChat() {
  if (!roomInfo) return;
  const text = (chatTextEl.value || '').trim();
  if (!text) return;
  socket.emit('chat_message', { text });
  chatTextEl.value = '';
}

chatSendBtn.addEventListener('click', () => {
  sendChat();
});

chatTextEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    sendChat();
  }
});

document.addEventListener('keydown', (event) => {
  if (!roomInfo || !roomInfo.running) return;
  const key = event.key.toLowerCase();
  const faces = { u: 'U', d: 'D', l: 'L', r: 'R', f: 'F', b: 'B' };
  if (!faces[key]) return;
  const isPlayer = roomInfo.players.some((p) => p.id === socket.id);
  if (!isPlayer) return;
  event.preventDefault();
  const dir = event.shiftKey ? -1 : 1;
  socket.emit('player_move', { face: faces[key], dir });
});

socket.on('room_joined', ({ info }) => {
  updateRoomUI(info);
  syncCubeViews(info.players, info.states);
  if (info && info.endTime) {
    const timeLeft = Math.max(0, Math.ceil((info.endTime - Date.now()) / 1000));
    updateTimer(timeLeft);
  }
  stopRoomPolling();
});

socket.on('chat_history', ({ messages }) => {
  setChatHistory(messages);
});

socket.on('chat_message', (message) => {
  appendChatMessage(message);
});

socket.on('join_error', ({ message }) => {
  setLobbyMessage(message || 'Unable to join room.');
});

socket.on('room_update', (info) => {
  updateRoomUI(info);
  syncCubeViews(info.players, info.states);
  if (info && info.endTime) {
    const timeLeft = Math.max(0, Math.ceil((info.endTime - Date.now()) / 1000));
    updateTimer(timeLeft);
  }
});

socket.on('rooms_list', ({ rooms }) => {
  renderRoomBoard(rooms);
});

socket.on('scramble', ({ moves }) => {
  statusText.textContent = 'Scrambling...';
  cubeViews.forEach((view) => {
    view.clearQueue();
    view.build();
    moves.forEach((move) => {
      view.enqueueMove(move, 80);
    });
  });
});

socket.on('move', ({ face, dir, playerId }) => {
  const view = cubeViews.get(playerId);
  if (!view) return;
  view.enqueueMove({ face, dir }, 240);
});

socket.on('timer', ({ timeLeft }) => {
  updateTimer(timeLeft);
});

socket.on('round_end', ({ result, winnerName }) => {
  if (result === 'win') {
    statusText.textContent = `Winner: ${winnerName}`;
  } else if (result === 'draw') {
    statusText.textContent = 'Draw. Two players solved in the same second.';
  } else {
    statusText.textContent = 'Time is up. No winner.';
  }
});

socket.on('promoted_to_player', () => {
  statusText.textContent = 'You are now a player.';
});

socket.on('connect', () => {
  socket.emit('list_rooms');
  startRoomPolling();
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

chatHeaderEl.addEventListener('pointerdown', (event) => {
  chatDragging = true;
  chatHeaderEl.classList.add('dragging');
  const rect = chatEl.getBoundingClientRect();
  chatDragOffsetX = event.clientX - rect.left;
  chatDragOffsetY = event.clientY - rect.top;
  chatEl.style.right = 'auto';
  chatEl.style.bottom = 'auto';
  chatEl.style.left = `${rect.left}px`;
  chatEl.style.top = `${rect.top}px`;
  chatHeaderEl.setPointerCapture(event.pointerId);
});

chatHeaderEl.addEventListener('pointermove', (event) => {
  if (!chatDragging) return;
  const maxX = window.innerWidth - chatEl.offsetWidth;
  const maxY = window.innerHeight - chatEl.offsetHeight;
  const left = clamp(event.clientX - chatDragOffsetX, 0, Math.max(0, maxX));
  const top = clamp(event.clientY - chatDragOffsetY, 0, Math.max(0, maxY));
  chatEl.style.left = `${left}px`;
  chatEl.style.top = `${top}px`;
});

function stopChatDrag(event) {
  if (!chatDragging) return;
  chatDragging = false;
  chatHeaderEl.classList.remove('dragging');
  chatHeaderEl.releasePointerCapture(event.pointerId);
}

chatHeaderEl.addEventListener('pointerup', stopChatDrag);
chatHeaderEl.addEventListener('pointercancel', stopChatDrag);

function startRoomPolling() {
  if (roomPollTimer) return;
  roomPollTimer = setInterval(() => {
    socket.emit('list_rooms');
  }, 6000);
}

function stopRoomPolling() {
  if (!roomPollTimer) return;
  clearInterval(roomPollTimer);
  roomPollTimer = null;
}
