const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const allowedOrigin = process.env.CLIENT_ORIGIN || "*";
const io = new Server(server, {
  cors: {
    origin: allowedOrigin
  }
});

const PORT = process.env.PORT || 3000;
const INITIAL_BALANCE = 10000;
const BASE_INCOME = 4000;
const BASE_EXPENSES = 2500;

const PHASE_NAMES = {
  0: "Lobby",
  1: "Estrategia inicial",
  2: "Resultado de estrategias e inversión",
  3: "Operación normal",
  4: "Evento especial + proyecto X",
  5: "Proyecto Y",
  6: "Resultados finales"
};

const PHASE_MAX_STEPS = {
  0: 0,
  1: 1,
  2: 3,
  3: 0,
  4: 1,
  5: 1,
  6: 0
};

const rooms = {};

app.use(
  cors({
    origin: allowedOrigin
  })
);
app.use(express.json());

function createRoom(roomCode) {
  return {
    roomCode,
    started: false,
    finished: false,
    phase: 0,
    phaseStep: 0,
    adminSocketId: null,
    players: [],
    logs: [],
    monthlyInputs: {},
    wheels: {
      strategyA: null,
      strategyC: null
    },
    winner: null,
    ranking: []
  };
}

function getRoom(roomCode) {
  const code = (roomCode || "AULA").trim().toUpperCase();
  if (!rooms[code]) {
    rooms[code] = createRoom(code);
  }
  return rooms[code];
}

function timestamp() {
  return new Date().toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function pushLog(room, message) {
  room.logs.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    time: timestamp(),
    message
  });

  if (room.logs.length > 50) {
    room.logs.shift();
  }
}

function getPlayer(room, socketId) {
  return room.players.find((player) => player.socketId === socketId) || null;
}

function getPlayerById(room, playerId) {
  return room.players.find((player) => player.id === playerId) || null;
}

function emitWheelEvent(targetSocketIds, eventName, payload) {
  const socketIds = Array.isArray(targetSocketIds) ? targetSocketIds : [targetSocketIds];

  socketIds.filter(Boolean).forEach((socketId) => {
    io.to(socketId).emit(eventName, payload);
  });
}

function hasPendingStrategyWheels(room) {
  const hasStrategyAPlayers = room.players.some((player) => player.strategy === "A");
  const hasStrategyCPlayers = room.players.some((player) => player.strategy === "C");

  return (
    (hasStrategyAPlayers && (!room.wheels.strategyA || room.wheels.strategyA.status !== "resolved")) ||
    (hasStrategyCPlayers && (!room.wheels.strategyC || room.wheels.strategyC.status !== "resolved"))
  );
}

function hasPendingProjectWheels(room, projectType) {
  return room.players.some((player) => player.project === projectType && !player.projectWheelResolved);
}

function createPlayer({ socketId, name, role }) {
  return {
    id: `${socketId}-${Math.random().toString(16).slice(2)}`,
    socketId,
    name: name.trim(),
    role,
    connected: true,
    balance: INITIAL_BALANCE,
    strategy: null,
    strategyApplied: false,
    project: null,
    projectSelectedPhase: null,
    projectReturnPhase: null,
    projectResolved: false,
    projectWheelResolved: false,
    projectWheelInProgress: false,
    projectWheel: null,
    customProjects: [],
    projectDecisionSubmitted: false,
    currentProjectRisk: 0,
    history: {
      0: INITIAL_BALANCE,
      1: INITIAL_BALANCE,
      2: INITIAL_BALANCE,
      3: INITIAL_BALANCE,
      4: INITIAL_BALANCE,
      5: INITIAL_BALANCE,
      6: INITIAL_BALANCE
    },
    transactions: []
  };
}

function serializePlayer(player) {
  return {
    id: player.id,
    socketId: player.socketId,
    name: player.name,
    role: player.role,
    connected: player.connected,
    balance: player.balance,
    strategy: player.strategy,
    strategyApplied: player.strategyApplied,
    project: player.project,
    projectSelectedPhase: player.projectSelectedPhase,
    projectResolved: player.projectResolved,
    projectWheelResolved: player.projectWheelResolved,
    projectWheelInProgress: player.projectWheelInProgress,
    projectWheel: player.projectWheel,
    history: { ...player.history },
    transactions: (player.transactions || []).slice(-50),
    customProjects: (player.customProjects || []).slice(-10),
    projectDecisionSubmitted: Boolean(player.projectDecisionSubmitted),
    projectReturnPhase: player.projectReturnPhase || null,
    currentProjectRisk: player.currentProjectRisk || 0
  };
}

function computeRanking(room) {
  return [...room.players]
    .map((player) => ({
      id: player.id,
      name: player.name,
      balance: player.balance,
      strategy: player.strategy,
      project: player.project,
      connected: player.connected
    }))
    .sort((left, right) => {
      if (right.balance !== left.balance) {
        return right.balance - left.balance;
      }

      return left.name.localeCompare(right.name, "es");
    });
}

function getRoomSnapshot(room) {
  const ranking = computeRanking(room);

  room.ranking = ranking;

  return {
    roomCode: room.roomCode,
    started: room.started,
    finished: room.finished,
    phase: room.phase,
    phaseName: PHASE_NAMES[room.phase] || "Desconocida",
    adminOnline: Boolean(room.adminSocketId),
    players: room.players.map(serializePlayer),
    ranking,
    logs: [...room.logs],
    monthlyInputs: { ...room.monthlyInputs },
    wheels: {
      strategyA: room.wheels.strategyA,
      strategyC: room.wheels.strategyC
    },
    phaseStep: room.phaseStep || 0,
    winner: room.winner
  };
}

function publishRoom(room, options = {}) {
  const snapshot = getRoomSnapshot(room);

  io.to(room.roomCode).emit("teams-updated", snapshot);

  if (options.phase) {
    io.to(room.roomCode).emit("phase-updated", {
      phase: snapshot.phase,
      phaseName: snapshot.phaseName,
      started: snapshot.started,
      finished: snapshot.finished,
      roomCode: snapshot.roomCode,
      phaseStep: snapshot.phaseStep
    });
  }

  if (options.balances) {
    io.to(room.roomCode).emit("balances-updated", {
      roomCode: snapshot.roomCode,
      players: snapshot.players.map((player) => ({
        id: player.id,
        name: player.name,
        balance: player.balance,
        strategy: player.strategy,
        project: player.project,
        projectDecisionSubmitted: player.projectDecisionSubmitted,
        projectReturnPhase: player.projectReturnPhase,
        history: player.history,
        transactions: player.transactions,
        customProjects: player.customProjects || [],
        currentProjectRisk: player.currentProjectRisk || 0
      }))
    });
  }

  if (options.ranking) {
    io.to(room.roomCode).emit("ranking-updated", snapshot.ranking);
  }

  if (options.finished) {
    io.to(room.roomCode).emit("game-finished", snapshot);
  }

  return snapshot;
}

function resetRoomForNewGame(room) {
  room.started = false;
  room.finished = false;
  room.phase = 0;
  room.monthlyInputs = {};
  room.wheels = {
    strategyA: null,
    strategyC: null
  };
  room.winner = null;
  room.ranking = [];
  room.phaseStep = 0;

  room.players.forEach((player) => {
    player.connected = true;
    player.balance = INITIAL_BALANCE;
    player.strategy = null;
    player.strategyApplied = false;
    player.project = null;
    player.projectSelectedPhase = null;
    player.projectReturnPhase = null;
    player.projectResolved = false;
    player.projectWheelResolved = false;
    player.projectWheelInProgress = false;
    player.projectWheel = null;
    player.customProjects = [];
    player.projectDecisionSubmitted = false;
    player.currentProjectRisk = 0;
    player.history = {
      0: INITIAL_BALANCE,
      1: INITIAL_BALANCE,
      2: INITIAL_BALANCE,
      3: INITIAL_BALANCE,
      4: INITIAL_BALANCE,
      5: INITIAL_BALANCE,
      6: INITIAL_BALANCE
    };
    player.transactions = [];
  });
}

function setPhaseSnapshot(room, phase) {
  room.players.forEach((player) => {
    player.history[phase] = player.balance;
  });
}

function applyInitialRound(room) {
  room.players.forEach((player) => {
    player.transactions = player.transactions || [];
    player.transactions.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      time: timestamp(),
      phase: 1,
      type: "initial-balance",
      amount: INITIAL_BALANCE,
      description: `Saldo inicial`
    });
    player.transactions.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      time: timestamp(),
      phase: 1,
      type: "income",
      amount: BASE_INCOME,
      description: `Ingreso fase 1`
    });
    player.transactions.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      time: timestamp(),
      phase: 1,
      type: "expense",
      amount: -BASE_EXPENSES,
      description: `Gasto fase 1`
    });
    player.balance = INITIAL_BALANCE + BASE_INCOME - BASE_EXPENSES;
    player.history[1] = player.balance;
  });
}

function getMonthlyImpact(player, income, expenses, phase, specialEventActive) {
  let adjustedIncome = income;
  let adjustedExpenses = expenses;

  if (player.strategy === "B") {
    adjustedIncome -= 1000;
    adjustedExpenses -= 1500;
  }

  if (phase === 4 && specialEventActive && player.strategy !== "B") {
    adjustedExpenses = Math.round(adjustedExpenses * 1.5);
  }

  return {
    income: adjustedIncome,
    expenses: adjustedExpenses
  };
}

function settleProjectReturns(room, phase) {
  let resolvedAny = false;

  room.players.forEach((player) => {
    if (player.projectResolved || player.projectReturnPhase !== phase) {
      return;
    }

    if (player.project === "Z") {
      const returnWheel = {
        type: "projectZ",
        scope: "project",
        status: "resolved",
        title: "Retorno del Proyecto Z",
        audience: "Usuarios con Proyecto Z",
        amount: 4000,
        label: "Retorno del Proyecto Z",
        outcome: "Retorno del Proyecto Z",
        options: [
          {
            label: "Retorno del Proyecto Z",
            value: "project-z-return",
            amount: 4000
          }
        ],
        selectedOption: "project-z-return",
        playerId: player.id,
        playerName: player.name,
        project: "Z"
      };

      emitWheelEvent([room.adminSocketId, player.socketId], "wheel-result", returnWheel);
      player.balance += 4000;
      player.projectResolved = true;
      player.history[phase] = player.balance;
      player.transactions = player.transactions || [];
      player.transactions.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        time: timestamp(),
        phase,
        type: "project-return",
        amount: 4000,
        description: `Retorno automático Proyecto Z`
      });
      pushLog(room, `${player.name} recupera el retorno automático de Proyecto Z.`);
      resolvedAny = true;
    }
  });

  if (resolvedAny) {
    publishRoom(room, { balances: true, ranking: true });
  }
}

function computeRiskForProject(projectRecord) {
  // Cálculo de riesgo basado en las reglas del usuario:
  // - Se considera la diferencia entre retorno esperado y la inversión (profitPercent).
  // - Según el % de margen (<=20%, 20-50%, >50%) y el tiempo (phases: 1..3) se asigna un riesgo fijo.
  // - Si el retorno es menor que la inversión (pérdida), el riesgo es muy alto.
  // - El valor devuelto es un % entre 0 y 100 que representa la porción "no-neutral" de la ruleta.
  //   Del % retornado, 10% será resultado bueno y 90% resultado malo; el resto (100 - %)
  //   será la porción neutral.

  const phases = Math.max(1, Math.min(3, Number(projectRecord.phases) || 1));
  const investment = Number(projectRecord.investment) || 0;
  const expected = Number(projectRecord.expectedReturn) || 0;

  if (investment <= 0) {
    return 90; // inversión inválida -> riesgo muy alto
  }

  const profit = expected - investment;
  const profitPercent = (profit / investment) * 100; // puede ser negativo

  // Regla principal (mapeo explícito):
  // profitPercent <= 20% => riesgo BAJO
  // 20% < profitPercent <= 50% => riesgo MEDIO/ALTO dependiendo de tiempo
  // profitPercent > 50% => riesgo ALTO/MUY ALTO
  // profitPercent < 0 => riesgo MUY ALTO (pérdida)

  let risk = 0;

  if (profitPercent < 0) {
    // Pérdida: riesgo muy alto (penaliza menos si el tiempo es más largo, pero sigue siendo alto)
    if (phases === 1) risk = 90;
    else if (phases === 2) risk = 85;
    else risk = 80;
  } else if (profitPercent <= 20) {
    // Margen pequeño: riesgo bajo pero no nulo
    if (phases === 1) risk = 15; // retorno en 1 fase -> bajo pero ligeramente mayor
    else if (phases === 2) risk = 10;
    else risk = 8; // retorno largo reduce un poco más el riesgo
  } else if (profitPercent <= 50) {
    // Margen medio: riesgo depende del tiempo
    if (phases === 1) risk = 70; // corto plazo y margen medio => riesgo ALTO
    else if (phases === 2) risk = 50; // intermedio
    else risk = 40; // largo plazo reduce riesgo a MEDIO
  } else {
    // profitPercent > 50 => potencialmente atractiva pero también llamativa; tratémosla como alto riesgo
    if (phases === 1) risk = 85; // gran ganancia en muy poco tiempo suele ser arriesgado
    else if (phases === 2) risk = 70;
    else risk = 60;
  }

  // Clamp final
  if (risk < 0) risk = 0;
  if (risk > 60) risk = 60;

  return risk;
}

function allProjectDecisionsSubmitted(room) {
  const players = room.players.filter((player) => player.role === "player");
  return players.length > 0 && players.every((player) => player.projectDecisionSubmitted);
}

function splitBadProjectSlots(badSlots) {
  if (badSlots <= 0) {
    return { half: 0, third: 0, zero: 0 };
  }

  let half = Math.round(badSlots * 0.6);
  let third = Math.round(badSlots * 0.3);
  let zero = badSlots - half - third;

  if (zero <= 0) {
    zero = 1;

    if (half >= third && half > 0) {
      half -= 1;
    } else if (third > 0) {
      third -= 1;
    }
  }

  return {
    half,
    third,
    zero
  };
}

function getCustomProjectWheelOptions(projectRecord, risk) {
  const expectedReturn = Math.max(0, Number(projectRecord.expectedReturn) || 0);
  const goodAmount = Math.round(expectedReturn * 1.1);
  const neutralAmount = expectedReturn;
  const halfAmount = Math.round(expectedReturn / 2);
  const thirdAmount = Math.round(expectedReturn / 3);
  const zeroAmount = 0;
  const slots = 10;
  const riskySlots = Math.max(0, Math.min(slots, Math.round(risk / 10)));
  const goodCount = riskySlots > 0 ? 1 : 0;
  const badCount = Math.max(0, riskySlots - goodCount);
  const neutralCount = slots - riskySlots;
  const badSplit = splitBadProjectSlots(badCount);

  const options = [];

  for (let index = 0; index < goodCount; index += 1) {
    options.push({
      label: "Retorno +10%",
      value: "good-plus-10",
      amount: goodAmount,
      category: "good"
    });
  }

  for (let index = 0; index < badSplit.half; index += 1) {
    options.push({
      label: "Retorno / 2",
      value: "bad-half",
      amount: halfAmount,
      category: "bad"
    });
  }

  for (let index = 0; index < badSplit.third; index += 1) {
    options.push({
      label: "Retorno / 3",
      value: "bad-third",
      amount: thirdAmount,
      category: "bad"
    });
  }

  for (let index = 0; index < badSplit.zero; index += 1) {
    options.push({
      label: "Retorno = 0",
      value: "bad-zero",
      amount: zeroAmount,
      category: "bad"
    });
  }

  for (let index = 0; index < neutralCount; index += 1) {
    options.push({
      label: "Retorno neutral",
      value: "neutral",
      amount: neutralAmount,
      category: "neutral"
    });
  }

  while (options.length < slots) {
    options.push({ label: "Retorno neutral", value: "neutral", amount: neutralAmount, category: "neutral" });
  }

  return options.slice(0, slots);
}

function applyCustomProjectWheelResult(room, player, selectedOption) {
  const projectRecord = (player.customProjects || []).slice(-1)[0] || null;

  if (!projectRecord) {
    return null;
  }

  const reward = Number(selectedOption?.amount) || 0;
  const wheelResult = {
    type: "customProject",
    scope: "individual",
    status: "resolved",
    title: `Retorno de ${projectRecord.name}`,
    audience: player.name,
    playerId: player.id,
    playerName: player.name,
    projectName: projectRecord.name,
    risk: player.currentProjectRisk || computeRiskForProject(projectRecord),
    returnPhase: projectRecord.returnPhase || projectRecord.phases,
    options: getCustomProjectWheelOptions(projectRecord, player.currentProjectRisk || computeRiskForProject(projectRecord)),
    selectedOption: selectedOption?.value || "neutral",
    label: selectedOption?.label || "Retorno neutral",
    amount: reward,
    outcome: selectedOption?.label || "Retorno neutral"
  };

  player.balance += reward;
  player.projectWheelResolved = true;
  player.projectResolved = true;
  player.projectWheelInProgress = false;
  player.projectWheel = wheelResult;
  player.history[room.phase] = player.balance;
  player.transactions = player.transactions || [];
  player.transactions.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    time: timestamp(),
    phase: room.phase,
    type: "project-wheel-custom",
    amount: reward,
    description: `Ruleta proyecto personalizado: ${selectedOption?.label || "Retorno neutral"}`
  });

  pushLog(room, `${player.name} resolvió su proyecto '${projectRecord.name}' con ${selectedOption?.label || "Retorno neutral"}.`);
  finalizeProjectWheel(room, player, wheelResult);

  return wheelResult;
}

function finalizeGlobalWheel(room, wheelType, resolvedWheel) {
  room.wheels[wheelType] = resolvedWheel;
  publishRoom(room, { balances: true, ranking: true });
  io.to(room.roomCode).emit("wheel-result", resolvedWheel);
}

function finalizeProjectWheel(room, player, resolvedWheel) {
  player.projectWheelResolved = true;
  player.projectWheelInProgress = false;
  player.projectWheel = resolvedWheel;
  publishRoom(room, { balances: true, ranking: true });
  emitWheelEvent([room.adminSocketId, player.socketId], "wheel-result", resolvedWheel);
}

function calculateProjectXReward(option) {
  if (option === "half") {
    return 3500;
  }

  if (option === "two-thousand") {
    return 2000;
  }

  if (option === "zero") {
    return 0;
  }

  if (option === "plus-one-thousand") {
    return 8000;
  }

  return 7000;
}

function calculateProjectYReward(option) {
  if (option === "discount-3000") {
    return 8000;
  }

  if (option === "discount-5000") {
    return 6000;
  }

  if (option === "discount-8000") {
    return 3000;
  }

  if (option === "discount-11000") {
    return 0;
  }

  if (option === "plus-2000") {
    return 13000;
  }

  return 11000;
}

function finishGame(room) {
  room.finished = true;
  room.phase = 6;
  room.ranking = computeRanking(room);
  room.winner = room.ranking[0] || null;
  pushLog(room, `Juego finalizado. Ganador: ${room.winner ? room.winner.name : "sin ganador"}.`);
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-game", (payload = {}) => {
    const roomCode = (payload.roomCode || payload.claveSala || "AULA").trim().toUpperCase();
    const groupName = (payload.groupName || payload.nombreGrupo || "Grupo").trim();
    const role = payload.role === "host" ? "host" : "player";
    const room = getRoom(roomCode);

    socket.join(roomCode);

    if (role === "host") {
      room.adminSocketId = socket.id;
      pushLog(room, "El administrador se conectó al panel de control.");
    } else {
      const existing = getPlayer(room, socket.id);

      if (existing) {
        existing.name = groupName;
        existing.connected = true;
      } else {
        const player = createPlayer({ socketId: socket.id, name: groupName, role });

        if (room.started) {
          const currentBalance = room.players.length > 0 ? room.players[0].balance : INITIAL_BALANCE;
          player.balance = currentBalance;
          player.history = {
            0: currentBalance,
            1: currentBalance,
            2: currentBalance,
            3: currentBalance,
            4: currentBalance,
            5: currentBalance,
            6: currentBalance
          };
        }

        room.players.push(player);
      }

      pushLog(room, `${groupName} entró a la sala ${room.roomCode}.`);
    }

    const snapshot = publishRoom(room, { phase: true, balances: true, ranking: true });

    socket.emit("teams-updated", snapshot);
    socket.emit("phase-updated", {
      phase: snapshot.phase,
      phaseName: snapshot.phaseName,
      started: snapshot.started,
      finished: snapshot.finished,
      roomCode: snapshot.roomCode,
      phaseStep: snapshot.phaseStep
    });
    socket.emit("ranking-updated", snapshot.ranking);
  });

  socket.on("start-game", ({ roomCode } = {}) => {
    const room = getRoom(roomCode);

    if (room.adminSocketId && room.adminSocketId !== socket.id) {
      return;
    }

    room.adminSocketId = socket.id;
    resetRoomForNewGame(room);
    room.started = true;
    room.phase = 1;
    applyInitialRound(room);
    setPhaseSnapshot(room, 1);
    pushLog(room, `El juego inició en la sala ${room.roomCode}.`);

    publishRoom(room, { phase: true, balances: true, ranking: true });
    io.to(room.roomCode).emit("game-started", getRoomSnapshot(room));
  });

  socket.on("submit-strategy", ({ roomCode, playerId, strategy } = {}) => {
    const room = getRoom(roomCode);
    const player = getPlayerById(room, playerId) || getPlayer(room, socket.id);

    if (!room.started || room.phase !== 1 || !player || player.role !== "player") {
      return;
    }

    if (player.strategyApplied) {
      return;
    }

    const strategies = {
      A: { cost: 1000 },
      B: { cost: 500 },
      C: { cost: 1500 }
    };

    if (!strategies[strategy]) {
      return;
    }

    player.strategy = strategy;
    player.strategyApplied = true;
    const cost = strategies[strategy].cost;
    player.balance -= cost;
    player.history[1] = player.balance;
    player.transactions = player.transactions || [];
    player.transactions.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      time: timestamp(),
      phase: room.phase,
      type: "strategy",
      amount: -cost,
      description: `Pago estrategia ${strategy}`
    });
    pushLog(room, `${player.name} eligió la estrategia ${strategy} y pagó ${cost}.`);

    publishRoom(room, { balances: true, ranking: true });
  });

  socket.on("submit-project", ({ roomCode, playerId, project } = {}) => {
    const room = getRoom(roomCode);
    const player = getPlayerById(room, playerId) || getPlayer(room, socket.id);

    if (!room.started || room.phase !== 2 || !player || player.project) {
      return;
    }

    if ((room.phaseStep || 0) < 2) {
      return;
    }

    const projects = {
      X: { cost: 5000, returnPhase: 4 },
      Y: { cost: 8000, returnPhase: 5 },
      Z: { cost: 3000, returnPhase: 3 }
    };

    if (!projects[project]) {
      return;
    }

    const selectedProject = projects[project];

    player.project = project;
    player.projectSelectedPhase = room.phase;
    player.projectReturnPhase = selectedProject.returnPhase;
    const cost = selectedProject.cost;
    player.balance -= cost;
    player.history[room.phase] = player.balance;
    player.transactions = player.transactions || [];
    player.transactions.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      time: timestamp(),
      phase: room.phase,
      type: "project-invest",
      amount: -cost,
      description: `Inversión en Proyecto ${project}`
    });

    pushLog(room, `${player.name} invirtió en Proyecto ${project} y pagó ${cost}.`);

    publishRoom(room, { balances: true, ranking: true });
  });

  // Soporte para decisiones que incluyen proyectos personalizados con ack callback
  socket.on("submit-decision", (payload = {}, callback) => {
    const { roomCode, playerId, decision } = payload || {};
    const room = getRoom(roomCode);
    const player = getPlayerById(room, playerId) || getPlayer(room, socket.id);

    if (!room.started || room.phase !== 2 || !player) {
      if (typeof callback === "function") callback({ ok: false, error: "Juego no iniciado o jugador inválido." });
      return;
    }

    if ((room.phaseStep || 0) < 2) {
      if (typeof callback === "function") callback({ ok: false, error: "Fase de proyectos no habilitada." });
      return;
    }

    if (decision && typeof decision === "object") {
      const prod = Number(decision.production) || 0;
      const price = Number(decision.price) || 0;
      player.pendingDecision = { production: prod, price };
    }

    const cp = decision && decision.customProject;

    if (cp && typeof cp === "object") {
      const name = String(cp.name || "").trim();
      const investment = Number(cp.investment) || 0;
      const phases = Number(cp.phases) || 1;
      const expectedReturn = Number(cp.expectedReturn) || 0;

      if (!name || investment <= 0) {
        if (typeof callback === "function") callback({ ok: false, error: "Nombre o inversión inválida." });
        return;
      }

      if (investment > player.balance) {
        if (typeof callback === "function") callback({ ok: false, error: "Saldo insuficiente." });
        return;
      }

      player.balance -= investment;
      player.history[room.phase] = player.balance;
      player.transactions = player.transactions || [];
      player.transactions.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        time: timestamp(),
        phase: room.phase,
        type: "project-invest-custom",
        amount: -investment,
        description: `Inversión en proyecto personalizado: ${name}`
      });

      player.customProjects = player.customProjects || [];
      const projectRecord = {
        name,
        investment,
        phases,
        expectedReturn,
        returnPhase: room.phase + phases,
        phase: room.phase,
        time: timestamp()
      };
      player.customProjects.push(projectRecord);

      player.project = name;
      player.projectSelectedPhase = room.phase;
      player.projectReturnPhase = projectRecord.returnPhase;
      player.projectDecisionSubmitted = true;

      pushLog(room, `${player.name} invirtió ${investment} en proyecto personalizado '${name}'.`);

      publishRoom(room, { balances: true, ranking: true });

      // Si todos los jugadores han enviado su decisión de proyecto, calcular riesgos y emitirlos
      const playersNeeding = room.players.filter((p) => p.role === "player");
      const allSubmitted = allProjectDecisionsSubmitted(room);

      if (allSubmitted) {
        const risks = playersNeeding.map((p) => {
          const lastProject = (p.customProjects || []).slice(-1)[0] || null;
          const risk = lastProject ? computeRiskForProject(lastProject) : 0;
          p.currentProjectRisk = risk;
          return { playerId: p.id, name: p.name, risk, returnPhase: p.projectReturnPhase || null };
        });

        // Publicar riesgos a la sala
        publishRoom(room, { balances: true, ranking: true });
        io.to(room.roomCode).emit("risk-updated", { risks });
      }

      if (typeof callback === "function") callback({ ok: true, balance: player.balance, customProject: projectRecord });
      return;
    }

    if (typeof callback === "function") callback({ ok: true });
  });

  socket.on("submit-month-values", ({ roomCode, income = 0, expenses = 0, specialEventActive = false } = {}) => {
    const room = getRoom(roomCode);

    if (!room.started || room.phase < 2 || room.phase > 5) {
      return;
    }

    // Prevent applying monthly values more than once per phase
    if (room.monthlyInputs[room.phase]) {
      return;
    }

    room.monthlyInputs[room.phase] = {
      income: Number(income) || 0,
      expenses: Number(expenses) || 0,
      specialEventActive: Boolean(specialEventActive)
    };

    room.players.forEach((player) => {
      const impact = getMonthlyImpact(
        player,
        Number(income) || 0,
        Number(expenses) || 0,
        room.phase,
        Boolean(specialEventActive)
      );

      const net = impact.income - impact.expenses;
      if (!player.transactions) player.transactions = [];
      if (impact.income) {
        player.transactions.push({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: timestamp(),
          phase: room.phase,
          type: "income",
          amount: impact.income,
          description: `Ingreso mensual fase ${room.phase}`
        });
      }

      if (impact.expenses) {
        player.transactions.push({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: timestamp(),
          phase: room.phase,
          type: "expense",
          amount: -impact.expenses,
          description: `Gasto mensual fase ${room.phase}`
        });
      }

      player.balance += net;
      player.history[room.phase] = player.balance;
    });

    pushLog(
      room,
      `Se aplicaron ingresos ${income} y gastos ${expenses} en la fase ${room.phase}${specialEventActive && room.phase === 4 ? " con evento especial" : ""}.`
    );

    settleProjectReturns(room, room.phase);

    // In phase 2, once monthly values are applied, move to confirmation step (step 1).
    if (room.phase === 2 && room.phaseStep < 1) {
      room.phaseStep = 1;
    }

    // In phases 4 and 5, once monthly values are applied, move to wheel step (step 1).
    if ((room.phase === 4 || room.phase === 5) && room.phaseStep < 1) {
      room.phaseStep = 1;
    }

    publishRoom(room, { phase: true, balances: true, ranking: true });
  });

  socket.on("spin-wheel", ({ roomCode, wheelType, playerId, option } = {}) => {
    const room = getRoom(roomCode);

    if (!room.started || room.phase < 2 || room.phase > 5) {
      return;
    }

    // In phase 2, wheels are in step 0 (strategy wheels before confirmation).
    // In phases 4 and 5, wheels are in step 1 (after monthly control).
    if (room.phase === 2 && (wheelType === "strategyA" || wheelType === "strategyC") && (room.phaseStep || 0) !== 0) {
      return;
    }
    if ((room.phase === 4 || room.phase === 5) && (room.phaseStep || 0) < 1) {
      return;
    }

    if (wheelType === "strategyA") {
      if (room.wheels.strategyA) {
        return;
      }

      const options = [
        { label: "Sí hubo crisis", value: "crisis", amount: 500 },
        { label: "No hubo crisis", value: "normal", amount: 3000 }
      ];
      const resolvedOption = option || (Math.random() < 0.5 ? "crisis" : "normal");
      const amount = resolvedOption === "crisis" ? 500 : 3000;

      const wheelResult = resolvedOption === "crisis" ? "Sí hubo crisis" : "No hubo crisis";
      room.wheels.strategyA = {
        type: "strategyA",
        scope: "global",
        status: "spinning",
        option: resolvedOption,
        amount,
        label: wheelResult,
        outcome: wheelResult,
        title: "Marketing",
        audience: "Toda la sala",
        options,
        selectedOption: resolvedOption
      };

      io.to(room.roomCode).emit("wheel-start", room.wheels.strategyA);

      setTimeout(() => {
        const currentWheel = room.wheels.strategyA;

        if (!currentWheel || currentWheel.status !== "spinning") {
          return;
        }

        room.players.forEach((player) => {
          if (player.strategy === "A") {
            player.balance += amount;
            player.history[2] = player.balance;
            player.transactions = player.transactions || [];
            player.transactions.push({
              id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
              time: timestamp(),
              phase: room.phase,
              type: "wheel-strategyA",
              amount: amount,
              description: `Resultado ruleta Marketing: ${currentWheel.label}`
            });
          }
        });

        pushLog(room, `Ruleta de Marketing resuelta: ${currentWheel.label}.`);
        finalizeGlobalWheel(room, "strategyA", {
          ...currentWheel,
          status: "resolved"
        });
      }, 1800);
      return;
    }

    if (wheelType === "strategyC") {
      if (room.wheels.strategyC) {
        return;
      }

      const options = [
        { label: "Innovación exitosa", value: "success", amount: 5000 },
        { label: "Innovación fallida", value: "fail", amount: 0 }
      ];
      const resolvedOption = option || (Math.random() < 0.5 ? "success" : "fail");
      const amount = resolvedOption === "success" ? 5000 : 0;

      const wheelResult = resolvedOption === "success" ? "Innovación exitosa" : "Innovación fallida";
      room.wheels.strategyC = {
        type: "strategyC",
        scope: "global",
        status: "spinning",
        option: resolvedOption,
        amount,
        label: wheelResult,
        outcome: wheelResult,
        title: "Innovación",
        audience: "Toda la sala",
        options,
        selectedOption: resolvedOption
      };

      io.to(room.roomCode).emit("wheel-start", room.wheels.strategyC);

      setTimeout(() => {
        const currentWheel = room.wheels.strategyC;

        if (!currentWheel || currentWheel.status !== "spinning") {
          return;
        }

        room.players.forEach((player) => {
          if (player.strategy === "C") {
            player.balance += amount;
            player.history[2] = player.balance;
            player.transactions = player.transactions || [];
            player.transactions.push({
              id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
              time: timestamp(),
              phase: room.phase,
              type: "wheel-strategyC",
              amount: amount,
              description: `Resultado ruleta Innovación: ${currentWheel.label}`
            });
          }
        });

        pushLog(room, `Ruleta de Innovación resuelta: ${currentWheel.label}.`);
        finalizeGlobalWheel(room, "strategyC", {
          ...currentWheel,
          status: "resolved"
        });
      }, 1800);
      return;
    }

    const player = getPlayerById(room, playerId) || getPlayer(room, socket.id);

    if (!player) {
      return;
    }

    if (wheelType === "projectReturn") {
      const projectRecord = (player.customProjects || []).slice(-1)[0] || null;

      if (!projectRecord || player.projectWheelResolved || room.phase !== projectRecord.returnPhase) {
        return;
      }

      const risk = player.currentProjectRisk || computeRiskForProject(projectRecord);
      const options = getCustomProjectWheelOptions(projectRecord, risk);
      const selected = options[Math.floor(Math.random() * options.length)];

      player.projectWheel = {
        type: "projectReturn",
        scope: "individual",
        status: "spinning",
        option: selected.value,
        amount: selected.amount,
        label: selected.label,
        outcome: selected.label,
        title: `Retorno de ${projectRecord.name}`,
        audience: player.name,
        options,
        selectedOption: selected.value,
        playerId: player.id,
        playerName: player.name,
        projectName: projectRecord.name,
        projectRisk: risk,
        returnPhase: projectRecord.returnPhase
      };

      player.projectWheelInProgress = true;
      emitWheelEvent([room.adminSocketId, player.socketId], "wheel-start", player.projectWheel);

      setTimeout(() => {
        const currentWheel = player.projectWheel;

        if (!currentWheel || currentWheel.status !== "spinning") {
          return;
        }

        applyCustomProjectWheelResult(room, player, selected);
      }, 1800);

      return;
    }

    if (wheelType === "projectX" && player.project === "X" && !player.projectWheelResolved && room.phase === 4) {
      const options = [
        { label: "Retorno reducido a la mitad", value: "half" },
        { label: "Retorno reducido a 2000", value: "two-thousand" },
        { label: "Retorno de 0", value: "zero" },
        { label: "Retorno +1000", value: "plus-one-thousand" },
        { label: "Resultado normal", value: "normal" },
        { label: "Resultado normal", value: "normal" },
        { label: "Resultado normal", value: "normal" },
        { label: "Resultado normal", value: "normal" },
        { label: "Resultado normal", value: "normal" },
        { label: "Resultado normal", value: "normal" }
      ];

      const selected = option || options[Math.floor(Math.random() * options.length)];
      const selectedValue = typeof selected === "string" ? selected : selected.value;
      const reward = calculateProjectXReward(selectedValue);

      player.projectWheel = {
        type: "projectX",
        scope: "individual",
        status: "spinning",
        option: selectedValue,
        amount: reward,
        label: typeof selected === "string" ? selected : selected.label,
        title: "Proyecto X",
        playerId: player.id,
        playerName: player.name,
        audience: player.name,
        options,
        selectedOption: selectedValue
      };

      player.projectWheelInProgress = true;
      emitWheelEvent([room.adminSocketId, player.socketId], "wheel-start", player.projectWheel);

      setTimeout(() => {
        const currentWheel = player.projectWheel;

        if (!currentWheel || currentWheel.status !== "spinning") {
          return;
        }

        player.balance += reward;
        player.projectWheelResolved = true;
        player.projectResolved = true;
        player.projectWheelInProgress = false;
        player.projectWheel = {
          ...currentWheel,
          status: "resolved"
        };
        player.history[4] = player.balance;
        player.transactions = player.transactions || [];
        player.transactions.push({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: timestamp(),
          phase: 4,
          type: "project-wheel",
          amount: reward,
          description: `Ruleta Proyecto X: ${player.projectWheel.label}`
        });

        pushLog(room, `${player.name} giró la ruleta de Proyecto X y obtuvo ${reward}.`);
        finalizeProjectWheel(room, player, player.projectWheel);
      }, 1800);
      return;
    }

    if (wheelType === "projectY" && player.project === "Y" && !player.projectWheelResolved && room.phase === 5) {
      const options = [
        { label: "Descuento 3000", value: "discount-3000" },
        { label: "Descuento 5000", value: "discount-5000" },
        { label: "Descuento 8000", value: "discount-8000" },
        { label: "Descuento 11000", value: "discount-11000" },
        { label: "Retorno +2000", value: "plus-2000" },
        { label: "Resultado normal", value: "normal" },
        { label: "Resultado normal", value: "normal" },
        { label: "Resultado normal", value: "normal" },
        { label: "Resultado normal", value: "normal" },
        { label: "Resultado normal", value: "normal" }
      ];

      const selected = option || options[Math.floor(Math.random() * options.length)];
      const selectedValue = typeof selected === "string" ? selected : selected.value;
      const reward = calculateProjectYReward(selectedValue);

      player.projectWheel = {
        type: "projectY",
        scope: "individual",
        status: "spinning",
        option: selectedValue,
        amount: reward,
        label: typeof selected === "string" ? selected : selected.label,
        title: "Proyecto Y",
        playerId: player.id,
        playerName: player.name,
        audience: player.name,
        options,
        selectedOption: selectedValue
      };

      player.projectWheelInProgress = true;
      emitWheelEvent([room.adminSocketId, player.socketId], "wheel-start", player.projectWheel);

      setTimeout(() => {
        const currentWheel = player.projectWheel;

        if (!currentWheel || currentWheel.status !== "spinning") {
          return;
        }

        player.balance += reward;
        player.projectWheelResolved = true;
        player.projectResolved = true;
        player.projectWheelInProgress = false;
        player.projectWheel = {
          ...currentWheel,
          status: "resolved"
        };
        player.history[5] = player.balance;
        player.transactions = player.transactions || [];
        player.transactions.push({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: timestamp(),
          phase: 5,
          type: "project-wheel",
          amount: reward,
          description: `Ruleta Proyecto Y: ${player.projectWheel.label}`
        });

        pushLog(room, `${player.name} giró la ruleta de Proyecto Y y obtuvo ${reward}.`);
        finalizeProjectWheel(room, player, player.projectWheel);
      }, 1800);
    }
  });

  socket.on("next-phase", ({ roomCode } = {}) => {
    const room = getRoom(roomCode);

    if (room.adminSocketId && room.adminSocketId !== socket.id) {
      return;
    }

    if (!room.started) {
      return;
    }

    if (room.phase >= 6) {
      return;
    }

    const requiredSteps = PHASE_MAX_STEPS[room.phase] || 0;

    if ((room.phaseStep || 0) < requiredSteps) {
      return;
    }

    setPhaseSnapshot(room, room.phase);

    if (room.phase === 2) {
      settleProjectReturns(room, 3);
    }

    room.phase += 1;
    room.phaseStep = 0;

    if (room.phase === 6) {
      finishGame(room);
    }

    pushLog(room, `El juego avanzó a la fase ${room.phase}: ${PHASE_NAMES[room.phase]}.`);
    publishRoom(room, { phase: true, balances: true, ranking: true, finished: room.finished });
  });

  socket.on("next-step", ({ roomCode } = {}) => {
    const room = getRoom(roomCode);

    if (room.adminSocketId && room.adminSocketId !== socket.id) {
      return;
    }

    if (!room.started) {
      return;
    }

    const requiredSteps = PHASE_MAX_STEPS[room.phase] || 0;

    if (requiredSteps === 0 || (room.phaseStep || 0) >= requiredSteps) {
      return;
    }

    room.phaseStep = (room.phaseStep || 0) + 1;
    pushLog(room, `El admin avanzó al paso ${room.phaseStep} de la fase ${room.phase}.`);
    publishRoom(room, { phase: true, balances: true, ranking: true });
  });

  socket.on("disconnect", () => {
    for (const room of Object.values(rooms)) {
      if (room.adminSocketId === socket.id) {
        room.adminSocketId = null;
        pushLog(room, "El administrador se desconectó.");
        publishRoom(room, { phase: true, balances: true, ranking: true });
        continue;
      }

      const player = getPlayer(room, socket.id);

      if (player) {
        player.connected = false;
        pushLog(room, `${player.name} se desconectó.`);
        publishRoom(room, { balances: true, ranking: true });
      }
    }

    console.log("User disconnected:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});