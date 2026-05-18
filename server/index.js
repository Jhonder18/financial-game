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
    projectWheel: null,
    history: {
      0: INITIAL_BALANCE,
      1: INITIAL_BALANCE,
      2: INITIAL_BALANCE,
      3: INITIAL_BALANCE,
      4: INITIAL_BALANCE,
      5: INITIAL_BALANCE,
      6: INITIAL_BALANCE
    }
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
    projectReturnPhase: player.projectReturnPhase,
    projectResolved: player.projectResolved,
    projectWheelResolved: player.projectWheelResolved,
    projectWheel: player.projectWheel,
    history: { ...player.history }
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
      roomCode: snapshot.roomCode
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
        history: player.history
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
    player.projectWheel = null;
    player.history = {
      0: INITIAL_BALANCE,
      1: INITIAL_BALANCE,
      2: INITIAL_BALANCE,
      3: INITIAL_BALANCE,
      4: INITIAL_BALANCE,
      5: INITIAL_BALANCE,
      6: INITIAL_BALANCE
    };
  });
}

function setPhaseSnapshot(room, phase) {
  room.players.forEach((player) => {
    player.history[phase] = player.balance;
  });
}

function applyInitialRound(room) {
  room.players.forEach((player) => {
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
  room.players.forEach((player) => {
    if (player.projectResolved || player.projectReturnPhase !== phase) {
      return;
    }

    if (player.project === "Z") {
      player.balance += 4000;
      player.projectResolved = true;
      player.history[phase] = player.balance;
      pushLog(room, `${player.name} recupera el retorno automático de Proyecto Z.`);
    }
  });
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
      roomCode: snapshot.roomCode
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
    player.balance -= strategies[strategy].cost;
    player.history[1] = player.balance;
    pushLog(room, `${player.name} eligió la estrategia ${strategy} y pagó ${strategies[strategy].cost}.`);

    publishRoom(room, { balances: true, ranking: true });
  });

  socket.on("submit-project", ({ roomCode, playerId, project } = {}) => {
    const room = getRoom(roomCode);
    const player = getPlayerById(room, playerId) || getPlayer(room, socket.id);

    if (!room.started || room.phase !== 2 || !player || player.project) {
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
    player.balance -= selectedProject.cost;
    player.history[room.phase] = player.balance;

    pushLog(room, `${player.name} invirtió en Proyecto ${project} y pagó ${selectedProject.cost}.`);

    publishRoom(room, { balances: true, ranking: true });
  });

  socket.on("submit-month-values", ({ roomCode, income = 0, expenses = 0, specialEventActive = false } = {}) => {
    const room = getRoom(roomCode);

    if (!room.started || room.phase < 2 || room.phase > 5) {
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

      player.balance += impact.income - impact.expenses;
      player.history[room.phase] = player.balance;
    });

    pushLog(
      room,
      `Se aplicaron ingresos ${income} y gastos ${expenses} en la fase ${room.phase}${specialEventActive && room.phase === 4 ? " con evento especial" : ""}.`
    );

    settleProjectReturns(room, room.phase);
    publishRoom(room, { balances: true, ranking: true });
  });

  socket.on("spin-wheel", ({ roomCode, wheelType, playerId, option } = {}) => {
    const room = getRoom(roomCode);

    if (!room.started || room.phase < 2 || room.phase > 5) {
      return;
    }

    if (wheelType === "strategyA") {
      if (room.wheels.strategyA) {
        return;
      }

      const resolvedOption = option || (Math.random() < 0.5 ? "crisis" : "normal");
      const amount = resolvedOption === "crisis" ? 500 : 3000;

      room.wheels.strategyA = {
        type: "strategyA",
        option: resolvedOption,
        amount,
        label: resolvedOption === "crisis" ? "Sí hubo crisis" : "No hubo crisis"
      };

      room.players.forEach((player) => {
        if (player.strategy === "A") {
          player.balance += amount;
          player.history[2] = player.balance;
        }
      });

      pushLog(room, `Ruleta de Marketing resuelta: ${room.wheels.strategyA.label}.`);
      publishRoom(room, { balances: true, ranking: true });
      io.to(room.roomCode).emit("wheel-result", room.wheels.strategyA);
      return;
    }

    if (wheelType === "strategyC") {
      if (room.wheels.strategyC) {
        return;
      }

      const resolvedOption = option || (Math.random() < 0.5 ? "success" : "fail");
      const amount = resolvedOption === "success" ? 5000 : 0;

      room.wheels.strategyC = {
        type: "strategyC",
        option: resolvedOption,
        amount,
        label: resolvedOption === "success" ? "Innovación exitosa" : "Innovación fallida"
      };

      room.players.forEach((player) => {
        if (player.strategy === "C") {
          player.balance += amount;
          player.history[2] = player.balance;
        }
      });

      pushLog(room, `Ruleta de Innovación resuelta: ${room.wheels.strategyC.label}.`);
      publishRoom(room, { balances: true, ranking: true });
      io.to(room.roomCode).emit("wheel-result", room.wheels.strategyC);
      return;
    }

    const player = getPlayerById(room, playerId) || getPlayer(room, socket.id);

    if (!player) {
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

      player.balance += reward;
      player.projectWheelResolved = true;
      player.projectResolved = true;
      player.projectWheel = {
        type: "projectX",
        option: selectedValue,
        amount: reward,
        label: typeof selected === "string" ? selected : selected.label
      };
      player.history[4] = player.balance;

      pushLog(room, `${player.name} giró la ruleta de Proyecto X y obtuvo ${reward}.`);
      publishRoom(room, { balances: true, ranking: true });
      io.to(room.roomCode).emit("wheel-result", player.projectWheel);
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

      player.balance += reward;
      player.projectWheelResolved = true;
      player.projectResolved = true;
      player.projectWheel = {
        type: "projectY",
        option: selectedValue,
        amount: reward,
        label: typeof selected === "string" ? selected : selected.label
      };
      player.history[5] = player.balance;

      pushLog(room, `${player.name} giró la ruleta de Proyecto Y y obtuvo ${reward}.`);
      publishRoom(room, { balances: true, ranking: true });
      io.to(room.roomCode).emit("wheel-result", player.projectWheel);
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

    setPhaseSnapshot(room, room.phase);

    if (room.phase === 2) {
      settleProjectReturns(room, 3);
    }

    room.phase += 1;

    if (room.phase === 6) {
      finishGame(room);
    }

    pushLog(room, `El juego avanzó a la fase ${room.phase}: ${PHASE_NAMES[room.phase]}.`);
    publishRoom(room, { phase: true, balances: true, ranking: true, finished: room.finished });
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