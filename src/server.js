// Decision Server: receives dino game state over REST and answers with an action from Jev.
const express = require('express');
const { ACTIONS, DecisionEngine } = require('./decision');

function createApp(engine = new DecisionEngine({ timeoutMs: Number(process.env.JEV_TIMEOUT_MS) || 5000 })) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  const stats = { decisions: 0, bySource: {}, byAction: {} };

  app.get('/health', (req, res) => {
    res.json({ ok: true, engine: engine.engine, actions: ACTIONS, stats });
  });

  app.post('/decide', async (req, res) => {
    const state = req.body;
    if (!state || !state.trex || !(state.obstacle || state.obstacles?.length)) {
      return res.status(400).json({ error: 'body must include trex and obstacle (or obstacles[])' });
    }
    const decision = await engine.decide(state);
    stats.decisions++;
    stats.bySource[decision.source] = (stats.bySource[decision.source] || 0) + 1;
    stats.byAction[decision.action] = (stats.byAction[decision.action] || 0) + 1;

    const o = decision.features?.obstacle;
    console.log(
      `[server] ${o ? `${o.type}(${o.altitude}, ${o.distance_px}px)` : '-'} -> ${decision.action}` +
        ` via ${decision.source}` +
        (decision.confidence != null ? ` conf=${decision.confidence.toFixed(2)}` : '') +
        ` ${decision.latencyMs}ms`,
    );
    res.json(decision);
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const app = createApp();
  app.listen(port, () => console.log(`[server] Decision server listening on http://localhost:${port}`));
}

module.exports = { createApp };
