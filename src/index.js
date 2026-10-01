// Runs the Decision Server and the CDP driver together; the driver still talks to it over REST.
const { createApp } = require('./server');
const { run } = require('./driver');

const port = Number(process.env.PORT) || 3000;
process.env.DECISION_URL ||= `http://localhost:${port}/decide`;

createApp().listen(port, () => {
  console.log(`[server] Decision server listening on http://localhost:${port}`);
  run().catch((err) => {
    console.error(`[driver] ${err.stack || err.message}`);
    process.exit(1);
  });
});
