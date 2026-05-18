import { useEffect, useState } from "react";
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
    const handleWheel = (payload) => setLastWheel(payload);

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
    socket.on("wheel-result", handleWheel);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("teams-updated", handleSnapshot);
      socket.off("game-started", handleSnapshot);
      socket.off("balances-updated", handleBalances);
      socket.off("game-finished", handleSnapshot);
      socket.off("ranking-updated");
      socket.off("phase-updated");
      socket.off("wheel-result", handleWheel);
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
  const emitMonthValues = (roomCode, income, expenses, specialEventActive) =>
    socket.emit("submit-month-values", { roomCode, income, expenses, specialEventActive });
  const emitWheel = (payload) => socket.emit("spin-wheel", payload);

  return {
    snapshot,
    lastWheel,
    connected,
    socketId: socket.id,
    emitJoin,
    emitStart,
    emitNext,
    emitNextStep,
    emitStrategy,
    emitProject,
    emitMonthValues,
    emitWheel
  };
}

function formatMoney(value) {
  return new Intl.NumberFormat("es-CO").format(Number(value || 0));
}

function App() {
  const game = useGameSocket();
  const [identity, setIdentity] = useState(loadIdentity);

  const persistIdentity = (nextIdentity) => {
    setIdentity(nextIdentity);
    saveIdentity(nextIdentity);
  };

  return (
    <BrowserRouter>
      <div className="app-shell">
        <Header connected={game.connected} snapshot={game.snapshot} />
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

  const strategyAPlayers = snapshot?.players?.filter((player) => player.strategy === "A") || [];
  const strategyCPlayers = snapshot?.players?.filter((player) => player.strategy === "C") || [];
  const projectXPlayers = snapshot?.players?.filter((player) => player.project === "X") || [];
  const projectYPlayers = snapshot?.players?.filter((player) => player.project === "Y") || [];
  const maxStepForPhase = phaseMaxSteps[currentPhase] ?? 0;
  const isStarted = Boolean(snapshot?.started);
  const canStartGame = !isStarted;
  const canGoNextStep = isStarted && currentPhase > 0 && currentPhase < 6 && currentStep < maxStepForPhase;
  const canGoNextPhase = isStarted && currentPhase > 0 && currentPhase < 6 && currentStep >= maxStepForPhase;
  const canApplyMonth = currentPhase >= 2 && currentPhase <= 5;
  const monthlyForCurrentPhase = snapshot?.monthlyInputs?.[currentPhase] || null;

  return (
    <section className={`content-grid content-grid--host phase-view phase-view--${currentPhase}`}>
      <PhaseBanner phase={currentPhase} role="admin" />

      {!adminUnlocked ? (
        <article className="panel panel-form">
          <p className="eyebrow">Acceso Admin</p>
          <h2>Validación de administrador</h2>
          <div className="form-grid">
            <label>
              Introduce la clave de confirmación
              <input value={adminPasscode} onChange={(e) => setAdminPasscode(e.target.value)} placeholder="Clave" />
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

      {canApplyMonth && (currentPhase !== 2 || currentStep === 0) && !((currentPhase === 4 || currentPhase === 5) && currentStep >= 1) ? (
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

      {currentPhase === 2 && currentStep >= 2 ? (
        <article className="panel panel-wide">
          <p className="eyebrow">Confirmación financiera de fase 2</p>
          <div className="callout">
            Admin seleccionó ingresos {formatMoney(monthlyForCurrentPhase?.income || 0)} y gastos {formatMoney(monthlyForCurrentPhase?.expenses || 0)}.
          </div>
          {currentStep === 1 ? (
            <div className="button-row">
              <button className="button button-primary" type="button" onClick={() => emitNextStep(currentRoom)}>
                Siguiente paso: habilitar selección de proyectos
              </button>
            </div>
          ) : null}
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
                    <td>{player.strategy || "Pendiente"}</td>
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
              <button
                className="button button-secondary"
                type="button"
                onClick={() => emitWheel({ roomCode: currentRoom, wheelType: "strategyA", option: Math.random() < 0.5 ? "crisis" : "normal" })}
              >
                Lanzar ruleta global
              </button>
            </div>
            <div className="wheel-card">
              <h3>Innovación</h3>
              <p>{strategyCPlayers.length} grupos con estrategia C</p>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => emitWheel({ roomCode: currentRoom, wheelType: "strategyC", option: Math.random() < 0.5 ? "success" : "fail" })}
              >
                Lanzar ruleta global
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
                </tr>
              </thead>
              <tbody>
                {(snapshot?.players || []).map((player) => (
                  <tr key={player.id}>
                    <td>{player.name}</td>
                    <td>{player.strategy || "-"}</td>
                    <td>{player.project || "Pendiente"}</td>
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
                <button
                  key={player.id}
                  className="button button-secondary button-block"
                  type="button"
                  onClick={() =>
                    emitWheel({ roomCode: currentRoom, wheelType: "projectX", playerId: player.id })
                  }
                >
                  Girar para {player.name}
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
                <button
                  key={player.id}
                  className="button button-secondary button-block"
                  type="button"
                  onClick={() =>
                    emitWheel({ roomCode: currentRoom, wheelType: "projectY", playerId: player.id })
                  }
                >
                  Girar para {player.name}
                </button>
              ))}
            </div>
          </div>

          <div className="table-wrap">
            <table >
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

function GamePage({ snapshot, lastWheel, emitStrategy, emitProject, identity, formatMoney }) {
  const [searchParams] = useSearchParams();
  const roomCode = identity?.roomCode || searchParams.get("room") || snapshot?.roomCode || "AULA";
  const phase = snapshot?.phase ?? 0;
  const phaseStep = snapshot?.phaseStep ?? 0;
  const monthlyForPhase2 = snapshot?.monthlyInputs?.[2] || null;
  const currentPlayer = snapshot?.players?.find(
    (player) =>
      identity &&
      snapshot?.roomCode === identity.roomCode &&
      ((identity.socketId && player.socketId === identity.socketId) ||
        player.name.trim().toLowerCase() === identity.groupName.trim().toLowerCase())
  );

  return (
    <section className={`content-grid content-grid--game phase-view phase-view--${phase}`}>
      <PhaseBanner phase={phase} role="player" />

      <article className="panel panel-form">
        <p className="eyebrow">Game</p>
        <h2>Tablero del grupo</h2>
        <p className="muted">Sala {roomCode}</p>
        {currentPlayer ? (
          <div className="stack">
            <Metric label="Saldo actual" value={formatMoney(currentPlayer.balance)} />
            <Metric label="Estrategia" value={currentPlayer.strategy || "Pendiente"} />
            <Metric label="Proyecto" value={currentPlayer.project || "Pendiente"} />
            <Metric label="Fase actual" value={snapshot ? phaseTitles[snapshot.phase] : "Pendiente"} />
            <Metric label="Estado" value={currentPlayer.connected ? "Conectado" : "Desconectado"} />
          </div>
        ) : (
          <p className="empty-state">Conéctate con un grupo desde /join para ver tu tablero.</p>
        )}
      </article>

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

      {phase === 2 && phaseStep >= 2 ? (
        <article className="panel panel-wide">
          <p className="eyebrow">Inversión del grupo</p>
          <DecisionSection
            title="Proyectos"
            items={projectCards}
            onAction={(item) => currentPlayer && emitProject(snapshot?.roomCode, currentPlayer.id, item.id)}
            actionLabel="Seleccionar proyecto"
            disabled={!currentPlayer || currentPlayer.project}
            phase={snapshot?.phase}
            requiredPhase={2}
            currentStep={snapshot?.phaseStep}
            requiredStep={2}
          />
        </article>
      ) : null}

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
          {lastWheel ? (
            <span>
              <strong>{lastWheel.outcome || lastWheel.label || lastWheel.option}</strong> ({lastWheel.amount > 0 ? "+" : ""}{formatMoney(lastWheel.amount)})
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
