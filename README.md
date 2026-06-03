# Financial Game

Juego de simulación empresarial multijugador en tiempo real.

**Resumen corto:** Juego educativo y competitivo donde varios jugadores gestionan empresas, toman decisiones financieras (producción, precios, inversión, préstamos), compiten en mercados y observan resultados en rondas en tiempo real.

**Tecnologías principales:**
- **Frontend:** React + Vite
- **Backend:** Node.js + Express
- **Tiempo real:** Socket.io

**¿Qué hace este repositorio?**
- Proporciona un cliente web (UI) donde los jugadores se conectan, ven el estado del juego y envían acciones.
- Provee un servidor en tiempo real que coordina partidas, mantiene el estado del juego (salas, jugadores, rondas) y difunde eventos a los clientes.

**Arquitectura y flujo (cómo lo hace):**
- El cliente (carpeta [client](client)) se conecta al servidor vía WebSocket usando `socket.io-client`.
- El servidor (archivo [server/index.js](server/index.js)) administra partidas y rooms, aplica la lógica del juego por fase y emite actualizaciones y resultados a los clientes.
- Estado: el servidor mantiene el estado de la partida en memoria y lo sincroniza con los clientes en cada evento importante (inicio de ronda, fin de ronda, cambios de mercado, resultados).

**Fases del juego (resumen):**
1. **Lobby / Emparejamiento:** jugadores se conectan, el anfitrión inicia la partida.
2. **Preparación:** configuración inicial (capital, plantillas, duración de rondas).
3. **Rondas / Turnos:** cada ronda contiene subfases como:
	 - **Fase de decisión:** los jugadores toman decisiones (producción, precios, inversión).
	 - **Fase de mercado:** se aplican eventos de demanda/oferta y resultados de ventas.
	 - **Fase de ajustes:** actualización de estados (ingresos, costos, préstamos, stock).
4. **Evaluación:** se muestran métricas y rankings (ganador por mejores finanzas).

**Características principales:**
- Multijugador en tiempo real con sincronización por sala.
- Lógica económica simplificada para aprender conceptos financieros.
- Interfaz React modular (componentes para lobby, tablero de control, mercado, resultados).
- Scripts de desarrollo que permiten arrancar cliente y servidor de forma simultánea.

**Estructura del repositorio (resumen):**
- [client](client) — aplicación frontend (Vite + React). Puntos clave:
	- [client/src/main.jsx](client/src/main.jsx)
	- [client/src/App.jsx](client/src/App.jsx)
- [server](server) — servidor Express + Socket.io. Archivo principal:
	- [server/index.js](server/index.js)
- `package.json` raíz — scripts para desarrollo conjunto (`npm run dev`).

**Instalación y ejecución (local):**

Requisitos:
- Node.js v18+ y npm

Instalar dependencias (opciones):

1) Instalar localmente por carpetas (recomendado para depuración):

```bash
cd client
npm install
cd ../server
npm install
```

2) Instalar en la raíz y en subproyectos (rápido):

```bash
npm install         # instala dependencias raíz (ej. concurrently)
npm run client --if-present || (cd client && npm install)
npm run server --if-present || (cd server && npm install)
```

Ejecutar en modo desarrollo:

```bash
# Desde la raíz (arranca cliente y servidor en paralelo)
npm run dev

# O por separado:
npm run server   # inicia el servidor (usa nodemon en dev)
npm run client   # inicia el cliente (vite)
```

Construir para producción (frontend):

```bash
cd client
npm run build
```

Despliegue:
- El cliente puede desplegarse en Vercel/Netlify/VPS estático (hay `client/vercel.json`).
- El servidor se puede desplegar en Heroku/Render/AWS/Container; asegúrate de exponer el `PORT` y configurar CORS si es necesario.

**Variables de entorno / Configuración:**
- Por defecto no hay variables obligatorias en este repositorio. Si despliegas el servidor, configura `PORT` y las orígenes CORS adecuadas.

**Cómo contribuir:**
- Clona el repo, crea una rama por feature/fix y abre un pull request. Sigue estas pautas:
	- Mantén los cambios enfocados y documenta la lógica nueva.
	- Ejecuta `npm run lint` dentro de `client` antes de subir cambios de frontend.

**Problemas comunes / Soluciones rápidas:**
- Si el cliente no se conecta al servidor: verifica la URL de Socket.io y el puerto; comprueba CORS.
- Si `npm run dev` falla: instala dependencias en `client` y `server` manualmente.

**Tests:**
- Actualmente no hay tests automatizados. Se pueden añadir pruebas unitarias para la lógica del servidor y pruebas de integración para sockets.

**Licencia:**
- El proyecto usa `ISC` (ver `package.json` raíz).

**Contacto / Repo:**
- Repositorio: https://github.com/Jhonder18/financial-game

---

Si quieres, puedo:
- Añadir capturas de pantalla o ejemplos del flujo de partidas.
- Documentar la API de sockets (eventos emitidos/esperados).
- Crear plantillas para issues y PRs.

**Ejemplos del flujo de partidas**

1) Flujo básico — Partida rápida (3 jugadores)
	- Jugadores A, B y C entran al lobby y se conectan al room `room:123` (`join_lobby`).
	- El anfitrión pulsa `start_game` → servidor inicializa estado (capital, stock, ronda=1) y emite `game_started` a la sala.
	- Ronda 1 — Fase de decisión (60s): cada jugador envía `submit_decision` con payload `{ production, price, invest }`.
	- Fin de la fase de decisión: servidor procesa decisiones, calcula ventas y emite `round_result` con `{ revenues, costs, stock, ranking }`.
	- Ronda 2...n: se repiten las fases hasta alcanzar `maxRounds`.
	- Fin de la partida: servidor emite `game_over` con el ranking final y estadísticas.

2) Ejemplo de secuencia de eventos Socket.io (resumen técnico)
	- Cliente -> Servidor: `join_lobby` { roomId, player }  
	- Servidor -> Sala: `player_joined` { players }  
	- Cliente (host) -> Servidor: `start_game` { roomId, config }  
	- Servidor -> Sala: `game_started` { initialState }  
	- Cliente -> Servidor: `submit_decision` { playerId, round, decision }  
	- Servidor -> Cliente: `decision_ack` { ok }  
	- Servidor -> Sala (al finalizar ronda): `round_result` { round, outcomes, marketEvent }  
	- Servidor -> Sala (fin): `game_over` { finalRanking, stats }

3) Escenario de ejemplo (decisiones y efecto en finanzas)
	- Jugador A decide producir mucho y baja el precio; vende gran volumen pero con margen menor.  
	- Jugador B produce menos y sube precio; vende menos pero mantiene margen.  
	- Jugador C invierte en capacidad; incurre en coste ahora pero puede aumentar producción en rondas posteriores.  
	- El servidor aplica la demanda del mercado y calcula ingresos/costos; al final de la ronda se actualiza capital y stock.

Notas: estos ejemplos son ilustrativos; los nombres de eventos y payloads pueden adaptarse según la implementación concreta en `server/index.js` y los componentes del cliente.

Actualizado: README completo generado automáticamente.
