import { createServer } from "node:http";
import { createObserverApplication } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const application = createObserverApplication(config);
const server = createServer(application.app);

server.listen(config.port, config.host, () => {
  console.info(
    `Univer Observer is running at http://${config.host}:${config.port}`
  );
});

server.on("error", (error) => {
  application.close();
  throw error;
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close((error) => {
      try {
        application.close();
      } finally {
        if (error) {
          console.error(error);
          process.exitCode = 1;
        }
      }
    });
  });
}
