const path = require("node:path");

const logsDir = path.join(__dirname, "logs");

module.exports = {
  apps: [
    {
      name: "rgclaw-web",
      cwd: __dirname,
      script: "src/server/index.ts",
      interpreter: process.env.BUN_BIN || "bun",
      interpreterArgs: "run",
      env_file: ".env",
      autorestart: true,
      watch: false,
      merge_logs: true,
      time: true,
      out_file: path.join(logsDir, "rgclaw-web.out.log"),
      error_file: path.join(logsDir, "rgclaw-web.err.log"),
    },
    {
      name: "rgclaw-collector",
      cwd: __dirname,
      script: "src/collectors/run.ts",
      interpreter: process.env.BUN_BIN || "bun",
      interpreterArgs: "run",
      env_file: ".env",
      autorestart: true,
      watch: false,
      merge_logs: true,
      time: true,
      out_file: path.join(logsDir, "rgclaw-collector.out.log"),
      error_file: path.join(logsDir, "rgclaw-collector.err.log"),
    },
    {
      name: "rgclaw-worker",
      cwd: __dirname,
      script: "src/workers/run.ts",
      interpreter: process.env.BUN_BIN || "bun",
      interpreterArgs: "run",
      env_file: ".env",
      autorestart: true,
      watch: false,
      merge_logs: true,
      time: true,
      out_file: path.join(logsDir, "rgclaw-worker.out.log"),
      error_file: path.join(logsDir, "rgclaw-worker.err.log"),
    },
  ],
};
