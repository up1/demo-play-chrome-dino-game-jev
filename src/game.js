// Reads and controls the Chrome dino game through CDP.
// `Runner` is a top-level class in the page's classic script, so it is reachable by
// name from Runtime.evaluate even though it is not a property of `window`.
const { sleep } = require('./cdp');

const READ_STATE = `(() => {
  if (typeof Runner === 'undefined') return null;
  let r;
  try { r = Runner.getInstance(); } catch { return null; }
  if (!r || !r.tRex || !r.horizon) return null;
  const t = r.tRex;
  // Tag obstacles with a stable id so the driver can track them across frames.
  for (const o of r.horizon.obstacles) if (o.__jevId === undefined) o.__jevId = (window.__jevSeq = (window.__jevSeq || 0) + 1);
  return {
    activated: r.activated,
    playing: r.playing,
    paused: r.paused,
    crashed: r.crashed,
    speed: r.currentSpeed,
    score: r.distanceMeter ? r.distanceMeter.getActualDistance(Math.ceil(r.distanceRan)) : 0,
    trex: {
      x: t.xPos,
      y: t.yPos,
      groundY: t.groundYPos,
      width: t.ducking ? t.config.widthDuck : t.config.width,
      height: t.ducking ? t.config.heightDuck : t.config.height,
      jumping: t.jumping,
      ducking: t.ducking,
    },
    canvasWidth: r.dimensions.width,
    obstacles: r.horizon.obstacles.map((o) => ({
      id: o.__jevId,
      type: o.typeConfig.type,
      x: o.xPos,
      y: o.yPos,
      width: o.width,
      height: o.typeConfig.height,
      size: o.size,
      speedOffset: o.speedOffset || 0,
    })),
  };
})()`;

const KEYS = {
  jump: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 },
  duck: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 },
};

class DinoGame {
  constructor(session) {
    this.session = session;
  }

  readState() {
    return this.session.evaluate(READ_STATE);
  }

  async waitUntilReady(timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.readState().catch(() => null)) return;
      await sleep(200);
    }
    throw new Error('Dino game did not load (Runner.getInstance() unavailable)');
  }

  #key(type, name) {
    return this.session.send('Input.dispatchKeyEvent', { type, ...KEYS[name] });
  }

  async jump() {
    await this.#key('keyDown', 'jump');
    await this.#key('keyUp', 'jump');
  }

  duckStart() {
    return this.#key('keyDown', 'duck');
  }

  duckEnd() {
    return this.#key('keyUp', 'duck');
  }

  /** Start a new game or restart after a crash (the game accepts Space for both). */
  start() {
    return this.jump();
  }

  /** Freeze the game loop while waiting for a slow decision. */
  pause() {
    return this.session.evaluate('Runner.getInstance().stop()');
  }

  resume() {
    return this.session.evaluate('Runner.getInstance().play()');
  }
}

module.exports = { DinoGame };
