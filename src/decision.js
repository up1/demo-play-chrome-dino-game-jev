// Turns raw game state into a decision: via Jev (TypeSafe systemOne) or a rule-based fallback.
const { TypeSafeClient, choice } = require('@typesafe-ai/sdk');

const ACTIONS = ['jump', 'duck', 'none'];

/** Describe the obstacle relative to the dino in terms a model can reason about. */
function describe(state, obstacle) {
  const { trex } = state;
  const standTop = trex.groundY;
  const bottom = trex.groundY + 47; // standing height; ducking keeps the same bottom
  const duckTop = bottom - 25;
  const obstacleTop = obstacle.y;
  const obstacleBottom = obstacle.y + obstacle.height;
  const isBird = obstacle.type === 'pterodactyl';

  let altitude = 'ground';
  if (isBird) {
    if (obstacleBottom <= standTop + 2) altitude = 'high';
    else if (obstacleBottom <= duckTop + 2) altitude = 'middle';
    else altitude = 'low';
  }

  return {
    speed_px_per_frame: Number(state.speed.toFixed(2)),
    dino: {
      standing_top_y: standTop,
      ducking_top_y: duckTop,
      bottom_y: bottom,
      is_jumping: trex.jumping,
      is_ducking: trex.ducking,
    },
    obstacle: {
      kind: isBird ? 'pterodactyl' : obstacle.type.startsWith('cactus') ? 'cactus' : obstacle.type,
      type: obstacle.type,
      count: obstacle.size,
      width_px: obstacle.width,
      top_y: obstacleTop,
      bottom_y: obstacleBottom,
      altitude,
      distance_px: Math.round(obstacle.x - (trex.x + trex.width)),
      hits_standing_dino: obstacleBottom > standTop + 2 && obstacleTop < bottom,
      hits_ducking_dino: obstacleBottom > duckTop + 2 && obstacleTop < bottom,
    },
    note: 'Screen y grows downward: a smaller y is higher in the sky.',
  };
}

function ruleDecide(features) {
  const o = features.obstacle;
  if (o.kind === 'cactus') return 'jump';
  if (o.kind !== 'pterodactyl') return 'none';
  if (!o.hits_standing_dino) return 'none';
  if (!o.hits_ducking_dino) return 'duck';
  return 'jump';
}

const QUESTIONS = {
  action: choice(
    'You control the T-Rex in the Chrome offline dino game. The obstacle described in the state is about to reach the dino. Which single action avoids a collision?',
    {
      jump: 'Jump over the obstacle. Correct for every cactus, and for a pterodactyl flying low that would hit the dino even while ducking (hits_ducking_dino is true).',
      duck: 'Duck under the obstacle. Correct only for a pterodactyl at middle altitude that would hit the standing dino but passes above the ducking dino (hits_standing_dino true, hits_ducking_dino false).',
      none: 'Keep running without input. Correct for a pterodactyl flying high above the standing dino (hits_standing_dino is false), or for a harmless collectable.',
    },
  ),
};

class DecisionEngine {
  constructor({ engine = process.env.DECISION_ENGINE || 'jev', timeoutMs = 5000 } = {}) {
    this.engine = engine;
    this.client = null;
    if (engine === 'jev') {
      if (!process.env.TYPESAFE_API_KEY) {
        console.warn('[decision] TYPESAFE_API_KEY is not set; using rule-based decisions');
        this.engine = 'rule';
      } else {
        this.client = new TypeSafeClient({ timeout: timeoutMs, retry: { maxRetries: 1 } });
      }
    }
  }

  async decide(state) {
    const obstacle = state.obstacle || state.obstacles?.[0];
    if (!obstacle) return { action: 'none', source: 'rule', reason: 'no obstacle' };
    const features = describe(state, obstacle);
    const started = Date.now();

    if (this.engine === 'jev') {
      try {
        const { model, answers, usage } = await this.client.systemOne({ state: features, questions: QUESTIONS });
        const { choice: action, confidence, probabilities } = answers.action;
        return { action, source: 'jev', model, confidence, probabilities, usage, features, latencyMs: Date.now() - started };
      } catch (err) {
        console.error(`[decision] Jev request failed, falling back to rules: ${err.message}`);
        return { action: ruleDecide(features), source: 'rule-fallback', error: err.message, features, latencyMs: Date.now() - started };
      }
    }
    return { action: ruleDecide(features), source: 'rule', features, latencyMs: Date.now() - started };
  }
}

module.exports = { ACTIONS, DecisionEngine, describe, ruleDecide };
