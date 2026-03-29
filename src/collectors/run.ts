import { insertLaunchEvent } from "../db/repositories/launch-events";
import { normalizeFlapEvent } from "./flap";
import { normalizeFourEvent } from "./four";

async function boot() {
  console.log("collector boot");

  const fourEvent = normalizeFourEvent({
    transactionHash: "demo-four",
    logIndex: 0,
    args: {
      memeToken: "0xfour",
      symbol: "FOUR",
    },
  });
  insertLaunchEvent(fourEvent);

  const flapEvent = normalizeFlapEvent({
    transactionHash: "demo-flap",
    logIndex: 0,
    args: {
      token: "0xflap",
      symbol: "FLAP",
    },
  });
  insertLaunchEvent(flapEvent);
}

boot().catch((error) => {
  console.error(error);
  process.exit(1);
});
