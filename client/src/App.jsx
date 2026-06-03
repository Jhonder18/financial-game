import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Link, NavLink, Route, Routes, useNavigate, useSearchParams } from "react-router-dom";
import { io } from "socket.io-client";
import "./App.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";
const socket = io(SERVER_URL, {
  transports: ["websocket"]
});

const IDENTITY_KEY = "financial-game-identity";

const phaseTitles = {
  0: "Lobby",
  1: "Estrategia inicial",
  2: "Resultado de estrategias e inversión",
  3: "Operación normal",
  4: "Evento especial + proyecto X",
  5: "Proyecto Y",
  6: "Resultados finales"
};

const phaseHints = {
  0: {
    admin: "Conecta la sala y espera grupos.",
    player: "Únete con tu nombre y clave de sala."
  },
  1: {
    admin: "Supervisa estrategias elegidas y luego avanza.",
    player: "Elige UNA estrategia inicial para tu grupo."
  },
  2: {
    admin: "Resuelve ruletas globales, carga mes y habilita proyectos.",
    player: "Mira resultados de estrategia y selecciona 1 proyecto."
  },
  3: {
    admin: "Aplica operación mensual y verifica retorno de Proyecto Z.",
    player: "Fase de operación normal. Revisa saldo actualizado."
  },
  4: {
    admin: "Activa evento especial y resuelve ruletas de Proyecto X.",
    player: "Gastos pueden subir 50% (excepto estrategia B)."
  },
  5: {
    admin: "Carga valores del mes y resuelve ruletas de Proyecto Y.",
    player: "Espera retorno final de Proyecto Y."
  },
  6: {
    admin: "Presenta ranking final y ganador.",
    player: "Revisa tabla final y posición de tu equipo."
  }
};

const strategyCards = [
  {
    id: "A",
    name: "Marketing",
    cost: 1000,
    effect: "+3000 en la siguiente fase",
    risk: "50% crisis",
    note: "Si hay crisis solo recibe +500"
  },
  {
    id: "B",
    name: "Reducir costos",
    cost: 500,
    effect: "Ingresos -1000 y gastos -1500 en todas las fases",
    risk: "Sin afectación al evento especial de fase 4",
    note: "Beneficio permanente"
  },
  {
    id: "C",
    name: "Innovación",
    cost: 1500,
    effect: "50% +5000 / 50% +0",
    risk: "Ruleta global de innovación",
    note: "Apuesta alta"
  }
];

const projectCards = [
  {
    id: "X",
    name: "Vallas en Marcha",
    cost: 5000,
    return: 7000,
    risk: "40%",
    time: 2
  },
  {
    id: "Y",
    name: "Expansión Total",
    cost: 8000,
    return: 11000,
    risk: "50%",
    time: 3
  },
  {
    id: "Z",
    name: "Impulso Digital",
    cost: 3000,
    return: 4000,
    risk: "0%",
    time: 1
  }
];

const phaseMaxSteps = {
  0: 0,
  1: 1,
  2: 3,
  3: 0,
  4: 1,
  5: 1,
  6: 0
};

function loadIdentity() {
  try {
    return JSON.parse(localStorage.getItem(IDENTITY_KEY) || "null");
  } catch {
    return null;
  }
}

function saveIdentity(identity) {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
}

function mergePlayers(existingPlayers = [], incomingPlayers = []) {
  const existingById = new Map(existingPlayers.map((player) => [player.id, player]));

  return incomingPlayers.map((player) => ({
    ...(existingById.get(player.id) || {}),
    ...player
  }));
}

function useGameSocket() {
  const [snapshot, setSnapshot] = useState(null);
  const [lastWheel, setLastWheel] = useState(null);
  const [activeWheel, setActiveWheel] = useState(null);
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);
    const handleSnapshot = (payload) => setSnapshot(payload);
    const handleBalances = (payload) => {
      setSnapshot((current) => {
        if (!current) {
          return {
            ...payload,
            players: payload.players || []
          };
        }

        return {
          ...current,
          ...payload,
          players: mergePlayers(current.players, payload.players)
        };
      });
    };
    const handleWheelStart = (payload) => {
      setActiveWheel({ ...payload, status: "spinning" });
    };
    const handleWheel = (payload) => {
      setActiveWheel({ ...payload, status: "resolved" });
      setLastWheel(payload);
    };

    const handleRiskUpdated = (payload) => {
      setSnapshot((current) => {
        if (!current || !payload || !payload.risks) return current;

        const updatedPlayers = (current.players || []).map((p) => {
          const found = payload.risks.find((r) => r.playerId === p.id);
          if (found) {
            return {
              ...p,
              currentProjectRisk: found.risk
            };
          }
          return p;
        });

        return {
          ...current,
          players: updatedPlayers
        };
      });
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("teams-updated", handleSnapshot);
    socket.on("game-started", handleSnapshot);
    socket.on("balances-updated", handleBalances);
    socket.on("game-finished", handleSnapshot);
    socket.on("ranking-updated", (ranking) => {
      setSnapshot((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          ranking
        };
      });
    });
    socket.on("phase-updated", (payload) => {
      setSnapshot((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          ...payload
        };
      });
    });
    socket.on("wheel-start", handleWheelStart);
    socket.on("wheel-result", handleWheel);
    socket.on("risk-updated", handleRiskUpdated);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("teams-updated", handleSnapshot);
      socket.off("game-started", handleSnapshot);
      socket.off("balances-updated", handleBalances);
      socket.off("game-finished", handleSnapshot);
      socket.off("ranking-updated");
      socket.off("phase-updated");
      socket.off("wheel-start", handleWheelStart);
      socket.off("wheel-result", handleWheel);
      socket.off("risk-updated", handleRiskUpdated);
    };
  }, []);

  const emitJoin = (payload) => socket.emit("join-game", payload);
  const emitStart = (roomCode) => socket.emit("start-game", { roomCode });
  const emitNext = (roomCode) => socket.emit("next-phase", { roomCode });
  const emitNextStep = (roomCode) => socket.emit("next-step", { roomCode });
  const emitStrategy = (roomCode, playerId, strategy) =>
    socket.emit("submit-strategy", { roomCode, playerId, strategy });
  const emitProject = (roomCode, playerId, project) =>
    socket.emit("submit-project", { roomCode, playerId, project });
  const emitDecision = (roomCode, playerId, decision, cb) =>
    socket.emit("submit-decision", { roomCode, playerId, decision }, cb);
  const emitMonthValues = (roomCode, income, expenses, specialEventActive) =>
    socket.emit("submit-month-values", { roomCode, income, expenses, specialEventActive });
  const emitWheel = (payload) => socket.emit("spin-wheel", payload);

  return {
    snapshot,
    lastWheel,
    activeWheel,
    clearActiveWheel: useCallback(() => setActiveWheel(null), []),
    connected,
    socketId: socket.id,
    emitJoin,
    emitStart,
    emitNext,
    emitNextStep,
    emitStrategy,
    emitProject,
    emitDecision,
    emitMonthValues,
    emitWheel
  };
}

function formatMoney(value) {
  return new Intl.NumberFormat("es-CO").format(Number(value || 0));
}

function findCurrentPlayer(snapshot, identity) {
  return snapshot?.players?.find(
    (player) =>
      identity &&
      snapshot?.roomCode === identity.roomCode &&
      ((identity.socketId && player.socketId === identity.socketId) ||
        player.name.trim().toLowerCase() === identity.groupName?.trim().toLowerCase())
  );
}

function wheelAppliesToPlayer(wheel, currentPlayer, identity) {
  if (!wheel) {
    return false;
  }

  if (identity?.role === "host") {
    return true;
  }

  if (!currentPlayer) {
    return false;
  }

  if (wheel.type === "strategyA") {
    return currentPlayer.strategy === "A";
  }

  if (wheel.type === "strategyC") {
    return currentPlayer.strategy === "C";
  }

  if (wheel.type === "projectZ") {
    return currentPlayer.project === "Z";
  }

  if (wheel.type === "projectX") {
    return currentPlayer.project === "X";
  }

  if (wheel.type === "projectY") {
    return currentPlayer.project === "Y";
  }

  if (wheel.type === "projectReturn") {
    return currentPlayer.projectReturnPhase === wheel.returnPhase || currentPlayer.id === wheel.playerId;
  }

  return true;
}

function allProjectDecisionsSubmitted(snapshot) {
  return Boolean(
    snapshot?.players?.filter((player) => player.role === "player").length &&
      snapshot.players.filter((player) => player.role === "player").every((player) => player.projectDecisionSubmitted)
  );
}

function clampNumber(value, min, max) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return min;
  }

  return Math.min(max, Math.max(min, numericValue));
}

function getWheelCategory(option = {}) {
  const label = String(option.label || option.value || "").toLowerCase();

  if (option.category) {
    return option.category;
  }

  if (label.includes("neutral") || label.includes("normal")) {
    return "neutral";
  }

  if (label.includes("good") || label.includes("retorno +") || Number(option.amount || 0) > 0) {
    return "good";
  }

  return "bad";
}

function groupWheelOptions(options = []) {
  return options.reduce(
    (accumulator, option) => {
      const category = getWheelCategory(option);
      accumulator[category].push(option);
      return accumulator;
    },
    { good: [], neutral: [], bad: [] }
  );
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

function buildProjectRiskWheelOptions(expectedReturn, risk) {
  const totalSlots = 10;
  const normalizedRisk = Math.max(0, Math.min(60, Number(risk) || 0));
  const riskySlots = Math.max(0, Math.min(totalSlots, Math.round(normalizedRisk / 10)));
  const goodSlots = riskySlots > 0 ? 1 : 0;
  const badSlots = Math.max(0, riskySlots - goodSlots);
  const neutralSlots = totalSlots - riskySlots;
  const badSplit = splitBadProjectSlots(badSlots);
  const amount = Math.max(0, Number(expectedReturn) || 0);

  const options = [];

  for (let index = 0; index < goodSlots; index += 1) {
    options.push({ label: "Retorno +10%", value: "good-plus-10", amount: Math.round(amount * 1.1), category: "good" });
  }

  for (let index = 0; index < badSplit.half; index += 1) {
    options.push({ label: "Retorno / 2", value: "bad-half", amount: Math.round(amount / 2), category: "bad" });
  }

  for (let index = 0; index < badSplit.third; index += 1) {
    options.push({ label: "Retorno / 3", value: "bad-third", amount: Math.round(amount / 3), category: "bad" });
  }

  for (let index = 0; index < badSplit.zero; index += 1) {
    options.push({ label: "Retorno = 0", value: "bad-zero", amount: 0, category: "bad" });
  }

  for (let index = 0; index < neutralSlots; index += 1) {
    options.push({ label: "Retorno neutral", value: "neutral", amount, category: "neutral" });
  }

  while (options.length < totalSlots) {
    options.push({ label: "Retorno neutral", value: "neutral", amount, category: "neutral" });
  }

  return options.slice(0, totalSlots);
}

function buildPreviewWheel(request, snapshot) {
  if (!request) {
    return null;
  }

  const player = snapshot?.players?.find((entry) => entry.id === request.playerId) || null;
  const lastCustomProject = player?.customProjects?.slice(-1)[0] || null;
  const risk = Number(player?.currentProjectRisk || 0);

  if (request.wheelType === "strategyA") {
    return {
      title: "Marketing",
      scope: "global",
      options: [
        { label: "Sí hubo crisis", value: "crisis", amount: 500, category: "bad" },
        { label: "No hubo crisis", value: "normal", amount: 3000, category: "good" }
      ]
    };
  }

  if (request.wheelType === "strategyC") {
    return {
      title: "Innovación",
      scope: "global",
      options: [
        { label: "Innovación exitosa", value: "success", amount: 5000, category: "good" },
        { label: "Innovación fallida", value: "fail", amount: 0, category: "bad" }
      ]
    };
  }

  if (request.wheelType === "projectX") {
    return {
      title: "Proyecto X",
      scope: "individual",
      playerName: player?.name || "N/A",
      options: [
        { label: "Retorno reducido a la mitad", value: "half", amount: 3500, category: "bad" },
        { label: "Retorno reducido a 2000", value: "two-thousand", amount: 2000, category: "bad" },
        { label: "Retorno de 0", value: "zero", amount: 0, category: "bad" },
        { label: "Retorno +1000", value: "plus-one-thousand", amount: 8000, category: "good" },
        { label: "Resultado normal", value: "normal", amount: 7000, category: "neutral" }
      ]
    };
  }

  if (request.wheelType === "projectY") {
    return {
      title: "Proyecto Y",
      scope: "individual",
      playerName: player?.name || "N/A",
      options: [
        { label: "Descuento 3000", value: "discount-3000", amount: 8000, category: "bad" },
        { label: "Descuento 5000", value: "discount-5000", amount: 6000, category: "bad" },
        { label: "Descuento 8000", value: "discount-8000", amount: 3000, category: "bad" },
        { label: "Descuento 11000", value: "discount-11000", amount: 0, category: "bad" },
        { label: "Retorno +2000", value: "plus-2000", amount: 13000, category: "good" },
        { label: "Resultado normal", value: "normal", amount: 11000, category: "neutral" }
      ]
    };
  }

  if (request.wheelType === "projectReturn") {
    const expectedReturn = Number(lastCustomProject?.expectedReturn || 0);
    const options = buildProjectRiskWheelOptions(expectedReturn, risk);

    return {
      title: `Retorno de ${lastCustomProject?.name || "proyecto"}`,
      scope: "individual",
      playerName: player?.name || "N/A",
      risk,
      options: options.length ? options : [{ label: "Retorno neutral", value: "neutral", amount: expectedReturn, category: "neutral" }]
    };
  }

  return null;
}

function getWheelResolvedIndex(wheel) {
  const options = wheel?.options || [];
  if (!options.length) {
    return 0;
  }

  const selectedValue = wheel?.selectedOption || wheel?.option;
  const selectedIndex = options.findIndex((option) => option.value === selectedValue);
  return selectedIndex >= 0 ? selectedIndex : 0;
}

function App() {
  const game = useGameSocket();
  const [identity, setIdentity] = useState(loadIdentity);
  const [winnerVisible, setWinnerVisible] = useState(true);
  const { activeWheel, clearActiveWheel, snapshot } = game;
  const currentPlayer = findCurrentPlayer(snapshot, identity);
  const visibleWheel = wheelAppliesToPlayer(activeWheel, currentPlayer, identity) ? activeWheel : null;

  useEffect(() => {
    setWinnerVisible(snapshot?.phase === 6);
  }, [snapshot?.phase, snapshot?.winner?.id]);

  useEffect(() => {
    if (!activeWheel) {
      return;
    }

    if (identity?.role === "host") {
      return;
    }

    if (!currentPlayer) {
      return;
    }

    if (!wheelAppliesToPlayer(activeWheel, currentPlayer, identity)) {
      clearActiveWheel();
    }
  }, [activeWheel, clearActiveWheel, currentPlayer, identity]);

  const persistIdentity = (nextIdentity) => {
    setIdentity(nextIdentity);
    saveIdentity(nextIdentity);
  };

  return (
    <BrowserRouter>
      <div className="app-shell">
        <Header connected={game.connected} snapshot={game.snapshot} />
        <WheelModal wheel={visibleWheel} formatMoney={formatMoney} onClose={clearActiveWheel} />
        <WinnerModal
          winner={game.snapshot?.winner}
          phase={game.snapshot?.phase}
          isOpen={winnerVisible}
          onClose={() => setWinnerVisible(false)}
          formatMoney={formatMoney}
        />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<LandingPage snapshot={game.snapshot} />} />
            <Route
              path="/join"
              element={
                <JoinPage
                  emitJoin={game.emitJoin}
                  snapshot={game.snapshot}
                  socketId={game.socketId}
                  persistIdentity={persistIdentity}
                />
              }
            />
            <Route
              path="/host"
              element={
                <HostPage
                  snapshot={game.snapshot}
                  lastWheel={game.lastWheel}
                  emitJoin={game.emitJoin}
                  emitStart={game.emitStart}
                  emitNext={game.emitNext}
                  emitNextStep={game.emitNextStep}
                  emitMonthValues={game.emitMonthValues}
                  emitWheel={game.emitWheel}
                  socketId={game.socketId}
                  persistIdentity={persistIdentity}
                />
              }
            />
            <Route
              path="/game"
              element={
                <GamePage
                  snapshot={game.snapshot}
                  lastWheel={game.lastWheel}
                  emitStrategy={game.emitStrategy}
                  emitProject={game.emitProject}
                  emitDecision={game.emitDecision}
                  identity={identity}
                  formatMoney={formatMoney}
                />
              }
            />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

function Header({ connected, snapshot }) {
  const phaseLabel = snapshot ? phaseTitles[snapshot.phase] || snapshot.phaseName : "Sin sala activa";

  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">Financial Game</p>
        <h1>Simulación empresarial multijugador en tiempo real</h1>
      </div>
      <div className="topbar-meta">
        <nav className="topnav">
          <NavLink to="/">Inicio</NavLink>
          <NavLink to="/join">Join</NavLink>
          <NavLink to="/host">Host</NavLink>
          <NavLink to="/game">Game</NavLink>
        </nav>
        <span className={connected ? "status online" : "status offline"}>
          {connected ? "Socket conectado" : "Socket desconectado"}
        </span>
        <span className="status neutral">{phaseLabel}</span>
      </div>
    </header>
  );
}

function LandingPage({ snapshot }) {
  return (
    <section className="hero-grid">
      <article className="hero-card hero-card--main">
        <p className="eyebrow">Juego financiero</p>
        <h2>Monolito simple, rápido y en memoria RAM</h2>
        <p className="hero-copy">
          Grupos entrando con nombre y clave de sala, tablero del administrador y actualización
          instantánea con Socket.io. El backend calcula toda la lógica financiera.
        </p>
        <div className="hero-actions">
          <Link className="button button-primary" to="/join">
            Unirse a una sala
          </Link>
          <Link className="button button-secondary" to="/host">
            Abrir panel admin
          </Link>
        </div>
        <div className="hero-stats">
          <Stat label="Fases" value="6" />
          <Stat label="Saldo inicial" value={formatMoney(10000)} />
          <Stat label="Tiempo real" value="Socket.io" />
        </div>
      </article>

      <article className="hero-card">
        <p className="eyebrow">Estado actual</p>
        {snapshot ? (
          <div className="stack">
            <Metric label="Sala" value={snapshot.roomCode} />
            <Metric label="Fase" value={snapshot.phaseName} />
            <Metric label="Grupos conectados" value={snapshot.players.length} />
            <Metric label="Ganador" value={snapshot.winner ? snapshot.winner.name : "Pendiente"} />
          </div>
        ) : (
          <p className="empty-state">Aún no hay una sala activa.</p>
        )}
      </article>
    </section>
  );
}

function PhaseBanner({ phase, role }) {
  const hint = phaseHints[phase]?.[role] || "";
  return (
    <article className="phase-banner panel panel-wide">
      <p className="eyebrow">{role === "admin" ? "Vista Admin" : "Vista Grupo"}</p>
      <h2>
        Fase {phase}: {phaseTitles[phase] || "En preparación"}
      </h2>
      <p>{hint}</p>
    </article>
  );
}

function JoinPage({ emitJoin, snapshot, socketId, persistIdentity }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [groupName, setGroupName] = useState(searchParams.get("group") || "");
  const [roomCode, setRoomCode] = useState(searchParams.get("room") || "AULA");

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!groupName.trim() || !roomCode.trim()) {
      return;
    }

    const normalizedRoom = roomCode.trim().toUpperCase();
    persistIdentity({
      groupName: groupName.trim(),
      roomCode: normalizedRoom,
      role: "player",
      socketId: socketId || null
    });
    emitJoin({ roomCode: normalizedRoom, groupName: groupName.trim(), role: "player" });
    navigate(`/game?room=${normalizedRoom}`);
  };

  return (
    <section className="content-grid">
      <article className="panel panel-form">
        <p className="eyebrow">Join</p>
        <h2>Ingresar como grupo</h2>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Nombre del grupo
            <input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="Grupo Alfa" />
          </label>
          <label>
            Clave de sala
            <input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="AULA" />
          </label>
          <button className="button button-primary" type="submit">
            Entrar al lobby
          </button>
        </form>
      </article>

      <article className="panel">
        <p className="eyebrow">Lobby en vivo</p>
        <LobbyPreview snapshot={snapshot} />
      </article>
    </section>
  );
}

function HostPage({ snapshot, lastWheel, emitJoin, emitStart, emitNext, emitNextStep, emitMonthValues, emitWheel, socketId, persistIdentity }) {
  const [roomCode, setRoomCode] = useState(snapshot?.roomCode || "AULA");
  const [income, setIncome] = useState(0);
  const [expenses, setExpenses] = useState(0);
  const [specialEventActive, setSpecialEventActive] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminPasscode, setAdminPasscode] = useState("");
  const [passError, setPassError] = useState("");
  const [wheelPreview, setWheelPreview] = useState(null);

  const currentRoom = snapshot?.roomCode || roomCode;

  const handleHostJoin = () => {
    persistIdentity({
      groupName: "Administrador",
      roomCode: currentRoom,
      role: "host",
      socketId: socketId || null
    });
    emitJoin({ roomCode: currentRoom, groupName: "Administrador", role: "host" });
  };

  const handleApplyMonthlyValues = () => {
    emitMonthValues(currentRoom, Number(income) || 0, Number(expenses) || 0, specialEventActive);
  };

  const currentPhase = snapshot?.phase ?? 0;
  const currentStep = snapshot?.phaseStep ?? 0;
  const hasMonthlyApplied = snapshot?.monthlyInputs?.[currentPhase] !== undefined;
  const allProjectSubmitted = allProjectDecisionsSubmitted(snapshot);
  const showPhase2MonthlyControl = currentPhase === 2 && currentStep >= 1;
  const showPhase45MonthlyControl = (currentPhase === 4 || currentPhase === 5) && currentStep === 0;
  const pendingProjectReturns = (snapshot?.players || []).filter(
    (player) => player.role === "player" && player.projectReturnPhase === currentPhase && !player.projectWheelResolved && player.projectDecisionSubmitted
  );

  const strategyAPlayers = snapshot?.players?.filter((player) => player.strategy === "A") || [];
  const strategyCPlayers = snapshot?.players?.filter((player) => player.strategy === "C") || [];
  const projectXPlayers = snapshot?.players?.filter((player) => player.project === "X") || [];
  const projectYPlayers = snapshot?.players?.filter((player) => player.project === "Y") || [];
  const maxStepForPhase = phaseMaxSteps[currentPhase] ?? 0;
  const isStarted = Boolean(snapshot?.started);
  const canStartGame = !isStarted;
  const canGoNextStep =
    isStarted &&
    currentPhase > 0 &&
    currentPhase < 6 &&
    currentStep < maxStepForPhase;
  const canGoNextPhase = isStarted && currentPhase > 0 && currentPhase < 6 && currentStep >= maxStepForPhase;
  const monthlyForCurrentPhase = snapshot?.monthlyInputs?.[currentPhase] || null;

  const openWheelPreview = (payload) => {
    setWheelPreview(payload);
  };

  const closeWheelPreview = () => {
    setWheelPreview(null);
  };

  return (
    <section className={`content-grid content-grid--host phase-view phase-view--${currentPhase}`}>
      <PhaseBanner phase={currentPhase} role="admin" />
      <WheelPreviewModal
        wheelRequest={wheelPreview}
        snapshot={snapshot}
        onClose={closeWheelPreview}
        onSpin={(payload) => {
          emitWheel(payload);
          closeWheelPreview();
        }}
      />

      {!adminUnlocked ? (
        <article className="panel panel-form">
          <p className="eyebrow">Acceso Admin</p>
          <h2>Validación de administrador</h2>
          <div className="form-grid">
            <label>
              Introduce la clave de confirmación
              <input
                type="password"
                autoComplete="new-password"
                value={adminPasscode}
                onChange={(e) => setAdminPasscode(e.target.value)}
                placeholder="Password"
              />
            </label>
            <div className="button-row">
              <button
                className="button button-primary"
                type="button"
                onClick={() => {
                  if (adminPasscode === "9876") {
                    setAdminUnlocked(true);
                    setPassError("");
                  } else {
                    setPassError("Clave incorrecta");
                  }
                }}
              >
                Confirmar
              </button>
            </div>
            {passError ? <div className="callout callout-error">{passError}</div> : null}
          </div>
        </article>
      ) : (
        <article className="panel panel-form">
          <p className="eyebrow">Host</p>
          <h2>Panel del administrador</h2>
          <div className="form-grid">
            <label>
              Sala
              <input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} />
            </label>
            <button className="button button-secondary" type="button" onClick={handleHostJoin}>
              Conectar como admin
            </button>
            <div className="button-row">
              <button
                className="button button-primary"
                type="button"
                onClick={() => emitStart(currentRoom)}
                disabled={!canStartGame}
              >
                Iniciar juego
              </button>
              <button
                className="button"
                type="button"
                onClick={() => emitNext(currentRoom)}
                disabled={!canGoNextPhase}
              >
                Avanzar fase
              </button>
              <button
                className="button"
                type="button"
                onClick={() => emitNextStep(currentRoom)}
                disabled={!canGoNextStep}
              >
                Siguiente paso
              </button>
            </div>
          </div>
        </article>
      )}

      {showPhase2MonthlyControl ? (
        <article className="panel">
          <p className="eyebrow">Control financiero fase 2</p>
          {currentStep === 1 && !hasMonthlyApplied ? (
            <>
              <div className="form-grid form-grid--inline">
                <label>
                  Ingresos del mes
                  <input type="number" value={income} onChange={(event) => setIncome(event.target.value)} />
                </label>
                <label>
                  Gastos del mes
                  <input type="number" value={expenses} onChange={(event) => setExpenses(event.target.value)} />
                </label>
              </div>
              <div className="button-row">
                <button className="button button-primary" type="button" onClick={handleApplyMonthlyValues} disabled={hasMonthlyApplied}>
                  Aplicar ingresos y gastos
                </button>
              </div>
            </>
          ) : (
            <div className="callout">
              Admin seleccionó ingresos {formatMoney(monthlyForCurrentPhase?.income || 0)} y gastos {formatMoney(monthlyForCurrentPhase?.expenses || 0)}.
            </div>
          )}
          {currentStep === 1 && hasMonthlyApplied ? (
            <div className="button-row">
              <button className="button button-primary" type="button" onClick={() => emitNextStep(currentRoom)}>
                Siguiente paso: habilitar selección de proyectos
              </button>
            </div>
          ) : null}
        </article>
      ) : null}

      {showPhase45MonthlyControl ? (
        <article className="panel">
          <p className="eyebrow">Control financiero</p>
          <div className="form-grid form-grid--inline">
            <label>
              Ingresos del mes
              <input type="number" value={income} onChange={(event) => setIncome(event.target.value)} />
            </label>
            <label>
              Gastos del mes
              <input type="number" value={expenses} onChange={(event) => setExpenses(event.target.value)} />
            </label>
          </div>
          {currentPhase === 4 ? (
            <label className="checkbox-row">
              <input type="checkbox" checked={specialEventActive} onChange={(event) => setSpecialEventActive(event.target.checked)} />
              Activar evento especial de fase 4
            </label>
          ) : null}
          <div className="button-row">
            <button className="button button-primary" type="button" onClick={handleApplyMonthlyValues} disabled={hasMonthlyApplied}>
              Aplicar ingresos y gastos
            </button>
          </div>
        </article>
      ) : null}

      {currentPhase === 1 && currentStep === 0 ? (
        <article className="panel panel-wide">
          <p className="eyebrow">Información inicial</p>
          <div className="callout">
            <strong>Valores iniciales:</strong>
            <br />Saldo inicial: {formatMoney(10000)}
            <br />Ingresos fase 1: {formatMoney(4000)}
            <br />Egresos fase 1: {formatMoney(2500)}
          </div>
          <div className="button-row">
            <button className="button button-primary" type="button" onClick={() => emitNextStep(currentRoom)}>
              Siguiente paso: Elegir estrategia
            </button>
          </div>
        </article>
      ) : null}

      {currentPhase === 1 && currentStep >= 1 ? (
        <article className="panel panel-wide">
          <p className="eyebrow">Monitoreo de estrategias</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th>Estrategia</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {(snapshot?.players || []).map((player) => (
                  <tr key={player.id}>
                    <td>{player.name}</td>
                    <td>{player.strategy || "-"}</td>
                    <td>{player.strategy ? "Votó" : "Esperando"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}

      {currentPhase === 2 && currentStep <= 1 ? (
        <article className="panel panel-wide">
          <p className="eyebrow">Ruletas globales</p>
          <div className="wheel-grid">
            <div className="wheel-card">
              <h3>Marketing</h3>
              <p>{strategyAPlayers.length} grupos con estrategia A</p>
              <button className="button button-secondary" type="button" onClick={() => openWheelPreview({ roomCode: currentRoom, wheelType: "strategyA" })}>
                Abrir ruleta
              </button>
            </div>
            <div className="wheel-card">
              <h3>Innovación</h3>
              <p>{strategyCPlayers.length} grupos con estrategia C</p>
              <button className="button button-secondary" type="button" onClick={() => openWheelPreview({ roomCode: currentRoom, wheelType: "strategyC" })}>
                Abrir ruleta
              </button>
            </div>
          </div>
          {lastWheel ? (
            <div className="callout">
              <strong>Última ruleta:</strong> {lastWheel.outcome || lastWheel.label || lastWheel.option} - {formatMoney(lastWheel.amount || 0)}
            </div>
          ) : null}
        </article>
      ) : null}

      {currentPhase === 2 && currentStep >= 2 ? (
        <article className="panel panel-wide">
          <p className="eyebrow">Monitoreo de selección de proyectos</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th>Estrategia</th>
                  <th>Proyecto</th>
                  <th>Retorno en</th>
                  <th>Riesgo</th>
                </tr>
              </thead>
              <tbody>
                {(snapshot?.players || []).map((player) => (
                  <tr key={player.id}>
                    <td>{player.name}</td>
                    <td>{player.strategy || "-"}</td>
                    <td>{player.project || "Pendiente"}</td>
                    <td>{player.projectReturnPhase || "-"}</td>
                    <td>{player.currentProjectRisk || 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}

      {currentPhase === 2 && currentStep >= 3 ? (
        <article className="panel panel-wide">
          <p className="eyebrow">Tabla de riesgo</p>
          <div className="callout">
            {allProjectSubmitted
              ? "Todos los equipos enviaron sus proyectos. Usa Siguiente fase para continuar al retorno correspondiente."
              : "Aún faltan equipos por enviar su proyecto."}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th>Proyecto</th>
                  <th>Fase retorno</th>
                  <th>Riesgo</th>
                </tr>
              </thead>
              <tbody>
                {(snapshot?.players || []).map((player) => (
                  <tr key={player.id}>
                    <td>{player.name}</td>
                    <td>{player.project || "Pendiente"}</td>
                    <td>{player.projectReturnPhase || "-"}</td>
                    <td>{player.currentProjectRisk != null ? `${player.currentProjectRisk}%` : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}

      {[3, 4, 5].includes(currentPhase) && pendingProjectReturns.length ? (
        <article className="panel panel-wide">
          <p className="eyebrow">Retornos de proyecto</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th>Proyecto</th>
                  <th>Fase retorno</th>
                  <th>Riesgo</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {pendingProjectReturns.map((player) => (
                  <tr key={player.id}>
                    <td>{player.name}</td>
                    <td>{player.project || player.name}</td>
                    <td>{player.projectReturnPhase}</td>
                    <td>{player.currentProjectRisk || 0}%</td>
                    <td>
                      <button className="button button-secondary" type="button" onClick={() => openWheelPreview({ roomCode: currentRoom, wheelType: "projectReturn", playerId: player.id })}>
                        Abrir ruleta de {player.name} con {player.currentProjectRisk || 0}% de riesgo
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}

      {currentPhase === 4 && currentStep >= 1 ? (
        <article className="panel panel-wide">
          <p className="eyebrow">Resolución Proyecto X</p>
          <div className="wheel-grid">
            <div className="wheel-card">
              <h3>Proyecto X</h3>
              <p>{projectXPlayers.length} grupos pendientes.</p>
              {projectXPlayers.map((player) => (
                <button key={player.id} className="button button-secondary button-block" type="button" onClick={() => openWheelPreview({ roomCode: currentRoom, wheelType: "projectX", playerId: player.id })}>
                  Abrir ruleta de {player.name}
                </button>
              ))}
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th>Proyecto</th>
                  <th>Estado X</th>
                </tr>
              </thead>
              <tbody>
                {(snapshot?.players || []).map((player) => (
                  <tr key={player.id}>
                    <td>{player.name}</td>
                    <td>{player.project || "-"}</td>
                    <td>{player.project === "X" ? (player.projectWheelResolved ? "Resuelto" : "Pendiente") : "No aplica"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}

      {currentPhase === 5 && currentStep >= 1 ? (
        <article className="panel panel-wide">
          <p className="eyebrow">Resolución Proyecto Y</p>
          <div className="wheel-grid">
            <div className="wheel-card">
              <h3>Proyecto Y</h3>
              <p>{projectYPlayers.length} grupos pendientes.</p>
              {projectYPlayers.map((player) => (
                <button key={player.id} className="button button-secondary button-block" type="button" onClick={() => openWheelPreview({ roomCode: currentRoom, wheelType: "projectY", playerId: player.id })}>
                  Abrir ruleta de {player.name}
                </button>
              ))}
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th>Proyecto</th>
                  <th>Estado Y</th>
                </tr>
              </thead>
              <tbody>
                {(snapshot?.players || []).map((player) => (
                  <tr key={player.id}>
                    <td>{player.name}</td>
                    <td>{player.project || "-"}</td>
                    <td>{player.project === "Y" ? (player.projectWheelResolved ? "Resuelto" : "Pendiente") : "No aplica"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}

      {currentPhase === 6 ? (
        <article className="panel panel-wide">
          <p className="eyebrow">Cierre de exposición</p>
          <RankingTable snapshot={snapshot} formatMoney={formatMoney} />
        </article>
      ) : null}

      <article className="panel panel-wide">
        <p className="eyebrow">Ranking y progreso</p>
        <RankingTable snapshot={snapshot} formatMoney={formatMoney} />
      </article>

      <article className="panel panel-wide">
        <p className="eyebrow">Lobby en vivo</p>
        <LobbyPreview snapshot={snapshot} />
      </article>
    </section>
  );
}

function GamePage({ snapshot, lastWheel, emitStrategy, emitProject, emitDecision, identity, formatMoney }) {
  const [searchParams] = useSearchParams();
  const roomCode = identity?.roomCode || searchParams.get("room") || snapshot?.roomCode || "AULA";
  const phase = snapshot?.phase ?? 0;
  const phaseStep = snapshot?.phaseStep ?? 0;
  const monthlyForPhase2 = snapshot?.monthlyInputs?.[2] || null;
  const currentPlayer = findCurrentPlayer(snapshot, identity);
  const allProjectSubmitted = allProjectDecisionsSubmitted(snapshot);
  const visibleLastWheel = wheelAppliesToPlayer(lastWheel, currentPlayer, identity) ? lastWheel : null;

  return (
    <section className={`content-grid content-grid--game phase-view phase-view--${phase}`}>
      <PhaseBanner phase={phase} role="player" />

      {phase === 2 && phaseStep === 0 ? (
        <article className="panel panel-wide">
          <div className="callout">Esperando a que el admin lance las ruletas de estrategia y seleccione ingresos y gastos de esta fase.</div>
        </article>
      ) : null}

      {phase === 2 && phaseStep === 1 ? (
        <article className="panel panel-wide">
          <div className="callout">
            El admin seleccionó ingresos {formatMoney(monthlyForPhase2?.income || 0)} y gastos {formatMoney(monthlyForPhase2?.expenses || 0)}.
            Esperando siguiente paso para habilitar selección de proyectos.
          </div>
        </article>
      ) : null}

      {phase === 0 ? (
        <article className="panel panel-wide">
          <p className="eyebrow">Sala de espera</p>
          <div className="callout">Esperando que el administrador inicie el juego.</div>
        </article>
      ) : null}

      {phase === 1 && phaseStep === 0 ? (
        <article className="panel panel-wide">
          <p className="eyebrow">Información inicial</p>
          <div className="callout">
            <strong>Valores iniciales de tu grupo:</strong>
            <br />Saldo inicial: {formatMoney(10000)}
            <br />Ingresos esta fase: {formatMoney(4000)}
            <br />Egresos esta fase: {formatMoney(2500)}
          </div>
          <p className="muted">Espera a que el administrador avance al siguiente paso para elegir estrategia.</p>
        </article>
      ) : null}

      {phase === 1 && phaseStep >= 1 ? (
        <article className="panel panel-wide">
          <p className="eyebrow">Elección de estrategia</p>
          <DecisionSection
            title="Estrategias"
            items={strategyCards}
            onAction={(item) => currentPlayer && emitStrategy(snapshot?.roomCode, currentPlayer.id, item.id)}
            actionLabel="Elegir estrategia"
            disabled={!currentPlayer || currentPlayer.strategy}
            phase={snapshot?.phase}
            requiredPhase={1}
            currentStep={snapshot?.phaseStep}
            requiredStep={1}
          />
        </article>
      ) : null}

      {phase === 2 && phaseStep >= 2 && !allProjectSubmitted ? (
        <article className="panel panel-wide">
          <p className="eyebrow">Inversión del grupo</p>
          <CustomDecisionForm
            disabled={!currentPlayer || currentPlayer.project}
            balance={currentPlayer?.balance || 0}
            phase={snapshot?.phase}
            requiredPhase={2}
            currentStep={snapshot?.phaseStep}
            requiredStep={2}
            onSubmit={(decision, cb) => currentPlayer && emitDecision(snapshot?.roomCode, currentPlayer.id, decision, cb)}
          />
        </article>
      ) : null}

      {phase === 2 && phaseStep >= 2 && allProjectSubmitted ? (
        <article className="panel panel-wide">
          <p className="eyebrow">Proyectos enviados</p>
          <div className="callout callout-success">
            Todos los equipos ya enviaron su proyecto. El administrador mostrará el riesgo y luego avanzará a la siguiente fase.
          </div>
        </article>
      ) : null}

      <article className="panel panel-wide">
        <p className="eyebrow">Tablero del grupo</p>
        <p className="muted">Sala {roomCode}</p>
        {currentPlayer ? (
          <div className="stack">
            <Metric label="Saldo actual" value={formatMoney(currentPlayer.balance)} />
            <Metric label="Estrategia" value={currentPlayer.strategy || "Pendiente"} />
            <Metric label="Proyecto" value={currentPlayer.project || "Pendiente"} />
            <Metric label="Riesgo proyecto" value={currentPlayer.currentProjectRisk != null ? `${currentPlayer.currentProjectRisk}%` : "Pendiente"} />
            <Metric label="Fase retorno" value={currentPlayer.projectReturnPhase || "Pendiente"} />
            <Metric label="Fase actual" value={snapshot ? phaseTitles[snapshot.phase] : "Pendiente"} />
            <Metric label="Estado" value={currentPlayer.connected ? "Conectado" : "Desconectado"} />
          </div>
        ) : (
          <p className="empty-state">Conéctate con un grupo desde /join para ver tu tablero.</p>
        )}
      </article>

      {(phase === 3 || phase === 4 || phase === 5) ? (
        <article className="panel panel-wide">
          <p className="eyebrow">Operación de fase</p>
          <div className="callout">
            {phase === 3 ? "Esperando liquidación mensual y retorno automático de Proyecto Z." : null}
            {phase === 4 && phaseStep === 0 ? "Esperando aplicación de control financiero..." : null}
            {phase === 4 && phaseStep >= 1 ? "Evento especial activo: vigila aumento de gastos y retorno de Proyecto X." : null}
            {phase === 5 && phaseStep === 0 ? "Esperando aplicación de control financiero..." : null}
            {phase === 5 && phaseStep >= 1 ? "Fase de retorno para Proyecto Y." : null}
          </div>
        </article>
      ) : null}

      <article className="panel panel-wide">
        <p className="eyebrow">Registro de movimientos</p>
        {currentPlayer && currentPlayer.transactions && currentPlayer.transactions.length ? (
          <div className="log-list">
            {currentPlayer.transactions.slice().reverse().map((t) => (
              <div key={t.id} className="log-item">
                <span>{t.time}</span>
                <p>{t.description} ({t.amount > 0 ? "+" : ""}{formatMoney(t.amount)})</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">Aún no hay movimientos para este grupo.</p>
        )}
      </article>

      <article className="panel panel-wide">
        <p className="eyebrow">Última ruleta</p>
        <div className="callout">
          {visibleLastWheel ? (
            <span>
              <strong>{visibleLastWheel.outcome || visibleLastWheel.label || visibleLastWheel.option}</strong> ({visibleLastWheel.amount > 0 ? "+" : ""}{formatMoney(visibleLastWheel.amount)})
            </span>
          ) : (
            <span>Sin ruletas ejecutadas aún.</span>
          )}
        </div>
      </article>

      {phase === 6 ? (
        <article className="panel panel-wide">
          <p className="eyebrow">Resultados finales</p>
          <RankingTable snapshot={snapshot} formatMoney={formatMoney} />
        </article>
      ) : null}

      <article className="panel panel-wide">
        <p className="eyebrow">Actividad reciente</p>
        <div className="log-list">
          {snapshot?.logs?.slice().reverse().slice(-8).map((entry) => (
            <div key={entry.id} className="log-item">
              <span>{entry.time}</span>
              <p>{entry.message}</p>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

function WheelModal({ wheel, formatMoney, onClose }) {
  const [displayedIndex, setDisplayedIndex] = useState(0);

  useEffect(() => {
    if (!wheel || !wheel.options || !wheel.options.length) {
      return undefined;
    }

    if (wheel.status === "spinning") {
      let currentIndex = 0;
      const intervalId = window.setInterval(() => {
        currentIndex = (currentIndex + 1) % wheel.options.length;
        setDisplayedIndex(currentIndex);
      }, 90);

      return () => window.clearInterval(intervalId);
    }

    if (wheel.status === "resolved") {
      const selectedIndex = getWheelResolvedIndex(wheel);
      const frameId = window.requestAnimationFrame(() => setDisplayedIndex(selectedIndex));

      const timeoutId = window.setTimeout(() => {
        onClose();
      }, 10000);

      return () => {
        window.cancelAnimationFrame(frameId);
        window.clearTimeout(timeoutId);
      };
    }

    return undefined;
  }, [wheel, onClose]);

  if (!wheel) {
    return null;
  }

  const options = wheel.options || [];
  const title = wheel.title || (wheel.type === "strategyA" ? "Marketing" : wheel.type === "strategyC" ? "Innovación" : wheel.type === "projectX" ? "Proyecto X" : wheel.type === "projectY" ? "Proyecto Y" : "Ruleta");
  const scopeText = wheel.scope === "individual" ? `Jugador: ${wheel.playerName || wheel.audience || "N/A"}` : "Afecta a toda la sala";
  const resultText = wheel.outcome || wheel.label || wheel.option || "Pendiente";
  const confettiPieces = wheel.status === "resolved" ? Array.from({ length: 14 }, (_, index) => index) : [];
  const activeIndex = wheel.status === "resolved" ? getWheelResolvedIndex(wheel) : displayedIndex % Math.max(1, options.length);
  const activeOption = options[activeIndex] || options[0] || null;

  return (
    <div className="wheel-modal-backdrop" role="dialog" aria-modal="true" aria-label="Resultado de ruleta">
      <section className="wheel-modal panel">
        <div className="wheel-modal__wheel-shell" aria-hidden="true">
          <div className="wheel-modal__pointer" />
          <div className={`wheel-modal__disc ${wheel.status === "spinning" ? "is-spinning" : "is-resolved"}`}>
            <div className="wheel-modal__disc-core">
              <span className="wheel-modal__status">{wheel.status === "spinning" ? "Girando" : "Cayó"}</span>
              <strong className="wheel-modal__option is-settled">{wheel.status === "resolved" ? resultText : activeOption?.label || "Girando"}</strong>
              <span className="wheel-modal__amount">
                {wheel.status === "resolved" ? `${wheel.amount >= 0 ? "+" : ""}${formatMoney(wheel.amount || 0)}` : `${options.length} opciones`}
              </span>
            </div>
          </div>
          <div className="wheel-modal__wheel-core wheel-modal__wheel-core--hidden">
            <span className="wheel-modal__status">{wheel.status === "spinning" ? "Girando" : "Cayó"}</span>
            <strong className="wheel-modal__option is-settled">{wheel.status === "resolved" ? resultText : activeOption?.label || "Girando"}</strong>
            <span className="wheel-modal__amount">
              {wheel.status === "resolved" ? `${wheel.amount >= 0 ? "+" : ""}${formatMoney(wheel.amount || 0)}` : `${options.length} opciones`}
            </span>
          </div>
          {confettiPieces.length ? (
            <div className="wheel-modal__confetti">
              {confettiPieces.map((piece) => (
                <span key={piece} className={`wheel-modal__confetti-piece wheel-modal__confetti-piece--${piece % 7}`} />
              ))}
            </div>
          ) : null}
        </div>
        <div className="wheel-modal__content">
          <p className="eyebrow">Resolución de ruleta</p>
          <h2>{title}</h2>
          <p className="muted">{scopeText}</p>
          {wheel.status === "spinning" ? (
            <div className="callout">La ruleta está girando en tiempo real. Espera el resultado final.</div>
          ) : (
            <div className="callout">
              <strong>{resultText}</strong>
              <br />
              Impacto aplicado: {wheel.amount >= 0 ? "+" : ""}{formatMoney(wheel.amount || 0)}
            </div>
          )}
          <div className="button-row">
            {wheel.status === "resolved" ? (
              <button className="button button-secondary" type="button" onClick={onClose}>
                Cerrar
              </button>
            ) : null}
          </div>
          <WheelOptionSections options={options} />
        </div>
      </section>
    </div>
  );
}

function WheelPreviewModal({ wheelRequest, snapshot, onClose, onSpin }) {
  const previewWheel = buildPreviewWheel(wheelRequest, snapshot);

  if (!wheelRequest || !previewWheel) {
    return null;
  }

  const options = previewWheel.options || [];
  return (
    <div className="wheel-modal-backdrop" role="dialog" aria-modal="true" aria-label="Vista previa de ruleta">
      <section className="wheel-modal panel">
        <div className="wheel-modal__wheel-shell" aria-hidden="true">
          <div className="wheel-modal__pointer" />
          <div className="wheel-modal__disc wheel-modal__disc--preview">
            <div className="wheel-modal__disc-core">
              <span className="wheel-modal__status">Vista previa</span>
              <strong className="wheel-modal__option is-settled">{previewWheel.title}</strong>
              <span className="wheel-modal__amount">10 opciones</span>
            </div>
          </div>
          <div className="wheel-modal__wheel-core wheel-modal__wheel-core--hidden">
            <span className="wheel-modal__status">Vista previa</span>
            <strong className="wheel-modal__option is-settled">{previewWheel.title}</strong>
            <span className="wheel-modal__amount">10 opciones</span>
          </div>
        </div>
        <div className="wheel-modal__content">
          <p className="eyebrow">Preparar ruleta</p>
          <h2>{previewWheel.title}</h2>
          <p className="muted">Pulsa girar dentro de la modal para ejecutar la ruleta de forma visible.</p>
          <div className="callout">
            <strong>{wheelRequest.wheelType}</strong>
            <br />
            {previewWheel.playerName ? `Jugador: ${previewWheel.playerName}` : "Ruleta global"}
          </div>
          <div className="button-row">
            <button className="button button-secondary" type="button" onClick={onClose}>
              Cerrar
            </button>
            <button className="button button-primary" type="button" onClick={() => onSpin(wheelRequest)}>
              Girar ruleta
            </button>
          </div>
          <WheelOptionSections options={options} />
        </div>
      </section>
    </div>
  );
}

function WinnerModal({ winner, phase, isOpen, onClose, formatMoney }) {
  if (!winner || phase !== 6 || !isOpen) {
    return null;
  }

  return (
    <div className="wheel-modal-backdrop" role="dialog" aria-modal="true" aria-label="Ganador final">
      <section className="wheel-modal panel">
        <div className="wheel-modal__wheel-shell wheel-modal__wheel-shell--winner" aria-hidden="true">
          <div className="wheel-modal__disc is-resolved">
            <div className="wheel-modal__disc-core">
              <span className="wheel-modal__status">Ganador</span>
              <strong className="wheel-modal__option is-settled">{winner.name}</strong>
              <span className="wheel-modal__amount">{formatMoney(winner.balance || 0)}</span>
            </div>
          </div>
        </div>
        <div className="wheel-modal__content">
          <p className="eyebrow">Resultados finales</p>
          <h2>Ganó {winner.name}</h2>
          <div className="callout callout-success">
            El equipo cerró la partida con {formatMoney(winner.balance || 0)}.
          </div>
          <div className="button-row">
            <button className="button button-secondary" type="button" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function WheelOptionSections({ options = [] }) {
  const grouped = groupWheelOptions(options);
  const total = options.length || 1;

  const sections = [
    { key: "bad", title: "Opciones negativas", items: grouped.bad, className: "wheel-section--bad" },
    { key: "good", title: "Opciones positivas", items: grouped.good, className: "wheel-section--good" },
    { key: "neutral", title: "Opciones neutras", items: grouped.neutral, className: "wheel-section--neutral" }
  ];

  return (
    <div className="wheel-sections">
      {sections.map((section) => (
        <section key={section.key} className={`wheel-section ${section.className}`}>
          <div className="wheel-section__header">
            <h3>{section.title}</h3>
            <span>{Math.round((section.items.length / total) * 100)}% del 100</span>
          </div>
          {section.items.length ? (
            <div className="wheel-section__list">
              {section.items.map((option, index) => (
                <div key={`${section.key}-${option.value}-${index}`} className="wheel-section__item">
                  <strong>{option.label}</strong>
                  <span>{option.amount >= 0 ? "+" : ""}{option.amount}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-state">Sin opciones.</p>
          )}
        </section>
      ))}
    </div>
  );
}

function LobbyPreview({ snapshot }) {
  if (!snapshot) {
    return <p className="empty-state">Esperando conexión del administrador y de los grupos.</p>;
  }

  return (
    <div className="lobby-layout">
      <div className="chip-row">
        <span className="chip">Sala: {snapshot.roomCode}</span>
        <span className="chip">Fase: {snapshot.phaseName}</span>
        <span className="chip">Admin: {snapshot.adminOnline ? "Activo" : "Desconectado"}</span>
      </div>
      <div className="team-list">
        {snapshot.players.length ? (
          snapshot.players.map((player) => (
            <div key={player.id} className="team-item">
              <div>
                <strong>{player.name}</strong>
                <p>
                  Estrategia {player.strategy || "-"} · Proyecto {player.project || "-"}
                </p>
              </div>
              <span className={player.connected ? "badge badge--good" : "badge badge--muted"}>
                {player.connected ? "Conectado" : "Desconectado"}
              </span>
            </div>
          ))
        ) : (
          <p className="empty-state">Todavía no hay grupos conectados.</p>
        )}
      </div>
      <div className="log-list">
        {snapshot.logs?.slice().reverse().slice(-6).map((entry) => (
          <div key={entry.id} className="log-item">
            <span>{entry.time}</span>
            <p>{entry.message}</p>
          </div>
        ))}
      </div>
      {snapshot.winner ? <div className="callout">Ganador actual: {snapshot.winner.name}</div> : null}
    </div>
  );
}

function DecisionSection({
  title,
  items,
  onAction,
  actionLabel,
  disabled,
  phase,
  requiredPhase,
  currentStep = 0,
  requiredStep = 0
}) {
  return (
    <div>
      <h3>{title}</h3>
      <div className="decision-list">
        {items.map((item) => (
          <article key={item.id} className="decision-card">
            <div>
              <strong>{item.name}</strong>
              <p>Costo {item.cost} · Retorno {item.return}</p>
            </div>
            <p>{item.effect || `Retorno ${item.return}`}</p>
            <p className="muted">Riesgo {item.risk} · Tiempo {item.time} fases</p>
            <button
              className="button button-secondary button-block"
              type="button"
              onClick={() => onAction(item)}
              disabled={disabled || phase !== requiredPhase || currentStep !== requiredStep}
            >
              {actionLabel}
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

function CustomDecisionForm({ disabled, balance = 0, phase, requiredPhase, currentStep = 0, requiredStep = 0, onSubmit }) {
  const [projectName, setProjectName] = useState("");
  const [phases, setPhases] = useState(1);
  const [investment, setInvestment] = useState(0);
  const [expectedReturn, setExpectedReturn] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    setError("");
    setSuccess("");
  }, [projectName, phases, investment, expectedReturn]);

  const isPhaseOK = phase === requiredPhase && currentStep === requiredStep;
  const invNum = Number(investment) || 0;
  const phNum = Number(phases) || 1;
  const canSubmit = !disabled && isPhaseOK && projectName.trim() && invNum > 0 && invNum <= Number(balance || 0) && phNum >= 1 && phNum <= 3;
  const maxExpectedReturn = Math.max(0, invNum * 2);

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!isPhaseOK) {
      setError("No se permite enviar en esta fase.");
      return;
    }

    const name = projectName.trim();
    if (!name) {
      setError("El nombre del proyecto es obligatorio.");
      return;
    }

    if (phNum < 1 || phNum > 3) {
      setError("El número de fases debe ser entre 1 y 3.");
      return;
    }

    if (invNum <= 0) {
      setError("La inversión debe ser mayor a 0.");
      return;
    }

    if (invNum > Number(balance || 0)) {
      setError("La inversión excede el saldo disponible.");
      return;
    }

    if (Number(expectedReturn) > maxExpectedReturn) {
      setError("La ganancia no puede superar el doble de la inversión.");
      return;
    }

    const decision = {
      production: 0,
      price: 0,
      customProject: {
        name,
        phases: phNum,
        investment: invNum,
        expectedReturn: Number(expectedReturn) || 0
      }
    };

    if (onSubmit) {
      try {
        onSubmit(decision, (ack) => {
          if (!ack) {
            setError("Sin respuesta del servidor.");
            return;
          }

          if (ack.ok) {
            setSuccess("Decisión aceptada por el servidor.");
            setProjectName("");
            setInvestment(0);
            setExpectedReturn(0);
            setPhases(1);
          } else {
            setError(ack.error || "Error al procesar la decisión.");
          }
        });
      } catch (err) {
        setError("Error enviando la decisión.");
      }
    } else {
      setSuccess("Decisión enviada localmente.");
      setProjectName("");
      setInvestment(0);
      setExpectedReturn(0);
      setPhases(1);
    }
  };

  return (
    <form className="form-grid" onSubmit={handleSubmit}>
      <label>
        Nombre del proyecto
        <input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Mi proyecto" />
      </label>
      <label>
        Número de fases (1-3)
        <input
          type="number"
          min="1"
          max="3"
          value={phases}
          onChange={(e) => setPhases(clampNumber(e.target.value, 1, 3))}
        />
      </label>
      <label>
        Monto a invertir (saldo disponible: {balance})
        <input
          type="number"
          min="0"
          max={balance}
          value={investment}
          onChange={(e) => {
            const nextInvestment = clampNumber(e.target.value, 0, Number(balance || 0));
            setInvestment(nextInvestment);
            setExpectedReturn((current) => clampNumber(current, 0, nextInvestment * 2));
          }}
        />
      </label>
      <label>
        Retorno esperado (máximo {formatMoney(maxExpectedReturn)})
        <input
          type="number"
          min="0"
          max={maxExpectedReturn}
          value={expectedReturn}
          onChange={(e) => setExpectedReturn(clampNumber(e.target.value, 0, maxExpectedReturn))}
        />
      </label>

      {error ? <div className="callout callout-error">{error}</div> : null}
      {success ? <div className="callout callout-success">{success}</div> : null}

      <div className="button-row">
        <button className="button button-primary" type="submit" disabled={!canSubmit}>
          Enviar decisión
        </button>
      </div>
    </form>
  );
}

function RankingTable({ snapshot, formatMoney }) {
  if (!snapshot?.ranking?.length) {
    return <p className="empty-state">El ranking aparecerá cuando los grupos empiecen a moverse.</p>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Posición</th>
            <th>Grupo</th>
            <th>Saldo</th>
            <th>Estrategia</th>
            <th>Proyecto</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.ranking.map((player, index) => (
            <tr key={player.id}>
              <td>{index + 1}</td>
              <td>{player.name}</td>
              <td>{formatMoney(player.balance)}</td>
              <td>{player.strategy || "-"}</td>
              <td>{player.project || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default App;
