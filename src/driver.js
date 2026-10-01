// Driver: plays chrome://dino over CDP, asking the Decision Server what to do for each obstacle.
const { ensureChrome, openDinoTab, sleep } = require('./cdp');
const { DinoGame } = require('./game');

const config = {
  cdpPort: Number(process.env.CDP_PORT) || 9333,
  gameUrl: process.env.GAME_URL || 'chrome://dino',
  decisionUrl: process.env.DECISION_URL || 'http://localhost:3000/decide',
  pollMs: Number(process.env.POLL_MS) || 8,
  // Freeze the game while a decision is still in flight at the moment it must be applied.
  pauseOnDecide: process.env.PAUSE_ON_DECIDE !== 'false',
  autoRestart: process.env.AUTO_RESTART !== 'false',
  maxGames: Number(process.env.MAX_GAMES) || Infinity,
};

/**
 * Horizontal gap (px) at which to jump so the dino's apex lines up with the obstacle.
 * A full jump keeps the dino clear of a cactus for roughly frames 5-27, apex near frame 16.
 */
function triggerDistance(speed, obstacle, trex) {
  const effectiveSpeed = speed + (obstacle.speedOffset || 0);
  return effectiveSpeed * 15 - (obstacle.width + trex.width) / 2;
}

async function requestDecision(state, obstacle) {
  const res = await fetch(config.decisionUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ speed: state.speed, trex: state.trex, obstacle, obstacles: state.obstacles }),
  });
  if (!res.ok) throw new Error(`Decision server HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function run() {
  const chrome = await ensureChrome(config.cdpPort);
  if (chrome) console.log(`[driver] Launched Chrome with --remote-debugging-port=${config.cdpPort}`);
  const session = await openDinoTab(config.cdpPort, config.gameUrl);
  const game = new DinoGame(session);
  await game.waitUntilReady();
  console.log(`[driver] Connected to ${config.gameUrl}; decisions from ${config.decisionUrl}`);

  const pending = new Map(); // obstacle id -> { promise, decision }
  const handled = new Set();
  let duckTargetId = null;
  let gamesPlayed = 0;
  const scores = [];

  let closing = false;
  session.onClose = () => {
    if (closing) return;
    console.error('[driver] Lost the CDP connection (was the game tab or Chrome closed?)');
    process.exit(1);
  };

  const shutdown = () => {
    closing = true;
    session.close();
    if (chrome) chrome.kill();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);

  await game.start();

  while (true) {
    const state = await game.readState();
    if (!state) {
      await sleep(100);
      continue;
    }

    if (state.crashed) {
      gamesPlayed++;
      scores.push(state.score);
      console.log(`[driver] Game over #${gamesPlayed}: score ${state.score} (best ${Math.max(...scores)})`);
      if (duckTargetId !== null) await game.duckEnd();
      duckTargetId = null;
      pending.clear();
      handled.clear();
      if (!config.autoRestart || gamesPlayed >= config.maxGames) break;
      await sleep(1300); // the game ignores restart input during its game-over clear time
      await game.start();
      await sleep(200);
      continue;
    }

    if (!state.playing) {
      await sleep(50);
      continue;
    }

    const { trex } = state;

    // Stand back up once the obstacle we ducked under has passed.
    if (duckTargetId !== null) {
      const ducked = state.obstacles.find((o) => o.id === duckTargetId);
      if (!ducked || ducked.x + ducked.width < trex.x) {
        await game.duckEnd();
        duckTargetId = null;
      }
    }

    const target = state.obstacles.find((o) => !handled.has(o.id) && o.x + o.width > trex.x);
    if (target) {
      // Ask early, as soon as the obstacle is on screen, to hide the decision latency.
      if (!pending.has(target.id) && target.x < state.canvasWidth) {
        const entry = { decision: null };
        entry.promise = requestDecision(state, target)
          .then((d) => (entry.decision = d))
          .catch((err) => {
            console.error(`[driver] ${err.message}`);
            entry.decision = { action: 'jump', source: 'driver-fallback' };
            return entry.decision;
          });
        pending.set(target.id, entry);
      }

      const gap = target.x - (trex.x + trex.width);
      if (!trex.jumping && gap <= triggerDistance(state.speed, target, trex)) {
        handled.add(target.id);
        const entry = pending.get(target.id);
        let paused = false;
        if (!entry.decision && config.pauseOnDecide) {
          await game.pause();
          paused = true;
        }
        const decision = entry.decision || (await entry.promise);
        if (paused) await game.resume();
        pending.delete(target.id);

        if (decision.action === 'jump') {
          if (duckTargetId !== null) {
            await game.duckEnd();
            duckTargetId = null;
          }
          await game.jump();
        } else if (decision.action === 'duck') {
          if (duckTargetId === null) await game.duckStart();
          duckTargetId = target.id;
        }
        console.log(
          `[driver] ${target.type}@y${target.y} gap=${Math.round(gap)} speed=${state.speed.toFixed(2)} -> ${decision.action}` +
            ` (${decision.source}${paused ? ', paused for decision' : ''})`,
        );
      }
    }

    await sleep(config.pollMs);
  }

  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  console.log(`[driver] Finished ${scores.length} game(s): best ${Math.max(...scores)}, average ${Math.round(avg)}`);
  shutdown();
}

if (require.main === module) {
  run().catch((err) => {
    console.error(`[driver] ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = { run, triggerDistance };
