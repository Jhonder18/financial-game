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

function useGameSocket() {
  const [snapshot, setSnapshot] = useState(null);
  const [lastWheel, setLastWheel] = useState(null);
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);
    const handleSnapshot = (payload) => setSnapshot(payload);
    const handleWheel = (payload) => setLastWheel(payload);

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("teams-updated", handleSnapshot);
    socket.on("game-started", handleSnapshot);
    socket.on("balances-updated", handleSnapshot);
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
      socket.off("balances-updated", handleSnapshot);
      socket.off("game-finished", handleSnapshot);
      socket.off("ranking-updated");
      socket.off("phase-updated");
      socket.off("wheel-result", handleWheel);
    };
  }, []);

  const emitJoin = (payload) => socket.emit("join-game", payload);
  const emitStart = (roomCode) => socket.emit("start-game", { roomCode });
  const emitNext = (roomCode) => socket.emit("next-phase", { roomCode });
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
    emitJoin,
    emitStart,
    emitNext,
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
                  emitMonthValues={game.emitMonthValues}
                  emitWheel={game.emitWheel}
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

function JoinPage({ emitJoin, snapshot, persistIdentity }) {
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
      socketId: socket.id || null
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

function HostPage({ snapshot, lastWheel, emitJoin, emitStart, emitNext, emitMonthValues, emitWheel, persistIdentity }) {
  const [roomCode, setRoomCode] = useState(snapshot?.roomCode || "AULA");
  const [income, setIncome] = useState(0);
  const [expenses, setExpenses] = useState(0);
  const [specialEventActive, setSpecialEventActive] = useState(false);

  const currentRoom = snapshot?.roomCode || roomCode;

  const handleHostJoin = () => {
    persistIdentity({
      groupName: "Administrador",
      roomCode: currentRoom,
      role: "host",
      socketId: socket.id || null
    });
    emitJoin({ roomCode: currentRoom, groupName: "Administrador", role: "host" });
  };

  const handleApplyMonthlyValues = () => {
    emitMonthValues(currentRoom, Number(income) || 0, Number(expenses) || 0, specialEventActive);
  };

  const strategyAPlayers = snapshot?.players?.filter((player) => player.strategy === "A") || [];
  const strategyCPlayers = snapshot?.players?.filter((player) => player.strategy === "C") || [];
  const projectXPlayers = snapshot?.players?.filter((player) => player.project === "X") || [];
  const projectYPlayers = snapshot?.players?.filter((player) => player.project === "Y") || [];

  return (
    <section className="content-grid content-grid--host">
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
            <button className="button button-primary" type="button" onClick={() => emitStart(currentRoom)}>
              Iniciar juego
            </button>
            <button className="button" type="button" onClick={() => emitNext(currentRoom)}>
              Avanzar fase
            </button>
          </div>
        </div>
      </article>

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
        <label className="checkbox-row">
          <input type="checkbox" checked={specialEventActive} onChange={(event) => setSpecialEventActive(event.target.checked)} />
          Activar evento especial de fase 4
        </label>
        <div className="button-row">
          <button className="button button-primary" type="button" onClick={handleApplyMonthlyValues}>
            Aplicar ingresos y gastos
          </button>
        </div>
      </article>

      <article className="panel panel-wide">
        <p className="eyebrow">Ruletas</p>
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
            <strong>Última ruleta:</strong> {lastWheel.label || lastWheel.option} - {formatMoney(lastWheel.amount || 0)}
          </div>
        ) : null}
      </article>

      <article className="panel panel-wide">
        <p className="eyebrow">Proyectos</p>
        <div className="wheel-grid">
          <div className="wheel-card">
            <h3>Proyecto X</h3>
            <p>{projectXPlayers.length} grupos</p>
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
          <div className="wheel-card">
            <h3>Proyecto Y</h3>
            <p>{projectYPlayers.length} grupos</p>
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
      </article>

      <article className="panel panel-wide">
        <p className="eyebrow">Lobby y ranking</p>
        <LobbyPreview snapshot={snapshot} />
      </article>
    </section>
  );
}

function GamePage({ snapshot, lastWheel, emitStrategy, emitProject, identity, formatMoney }) {
  const [searchParams] = useSearchParams();
  const roomCode = identity?.roomCode || searchParams.get("room") || snapshot?.roomCode || "AULA";
  const currentPlayer = snapshot?.players?.find(
    (player) =>
      identity &&
      snapshot?.roomCode === identity.roomCode &&
      ((identity.socketId && player.socketId === identity.socketId) ||
        player.name.trim().toLowerCase() === identity.groupName.trim().toLowerCase())
  );

  return (
    <section className="content-grid content-grid--game">
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

      <article className="panel panel-wide">
        <p className="eyebrow">Decisiones disponibles</p>
        <div className="decision-grid">
          <DecisionSection
            title="Estrategias"
            items={strategyCards}
            onAction={(item) => currentPlayer && emitStrategy(snapshot?.roomCode, currentPlayer.id, item.id)}
            actionLabel="Elegir estrategia"
            disabled={!currentPlayer || currentPlayer.strategy}
            phase={snapshot?.phase}
            requiredPhase={1}
          />
          <DecisionSection
            title="Proyectos"
            items={projectCards}
            onAction={(item) => currentPlayer && emitProject(snapshot?.roomCode, currentPlayer.id, item.id)}
            actionLabel="Seleccionar proyecto"
            disabled={!currentPlayer || currentPlayer.project}
            phase={snapshot?.phase}
            requiredPhase={2}
          />
        </div>
      </article>

      <article className="panel panel-wide">
        <p className="eyebrow">Resultados y ranking</p>
        <div className="callout">
          {lastWheel ? (
            <span>
              Última ruleta: <strong>{lastWheel.label || lastWheel.option}</strong>
            </span>
          ) : (
            <span>Sin ruletas ejecutadas aún.</span>
          )}
        </div>
        <RankingTable snapshot={snapshot} formatMoney={formatMoney} />
      </article>

      <article className="panel panel-wide">
        <p className="eyebrow">Tabla final</p>
        <HistoryTable snapshot={snapshot} formatMoney={formatMoney} />
      </article>

      <article className="panel panel-wide">
        <p className="eyebrow">Actividad reciente</p>
        <div className="log-list">
          {snapshot?.logs?.slice(-8).map((entry) => (
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
        {snapshot.logs?.slice(-6).map((entry) => (
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

function DecisionSection({ title, items, onAction, actionLabel, disabled, phase, requiredPhase }) {
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
              disabled={disabled || phase !== requiredPhase}
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

function HistoryTable({ snapshot, formatMoney }) {
  if (!snapshot?.players?.length) {
    return <p className="empty-state">Aún no hay datos para la tabla final.</p>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Grupo</th>
            <th>Saldo inicial</th>
            <th>Después F1</th>
            <th>Después F2</th>
            <th>Después F3</th>
            <th>Después F4</th>
            <th>Después F5</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.players.map((player) => (
            <tr key={player.id}>
              <td>{player.name}</td>
              <td>{formatMoney(player.history?.[0])}</td>
              <td>{formatMoney(player.history?.[1])}</td>
              <td>{formatMoney(player.history?.[2])}</td>
              <td>{formatMoney(player.history?.[3])}</td>
              <td>{formatMoney(player.history?.[4])}</td>
              <td>{formatMoney(player.history?.[5])}</td>
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
