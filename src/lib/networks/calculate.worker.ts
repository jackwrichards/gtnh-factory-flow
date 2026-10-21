import { calculateThroughput } from "@/lib/solver";
import { initLpEngine } from "@/lib/solver/lp-engine";
import type { FactoryProject } from "@/lib/model/types";
import { planFlows } from "./plan-flows";

const ready = initLpEngine({
  glueUrl: "/api/highs/highs.js",
  wasmUrl: "/api/highs/highs.wasm",
  fallback: { glueUrl: "/highs.js", wasmUrl: "/highs.wasm" },
});
self.onmessage = async ({ data }: MessageEvent<FactoryProject>) => {
  try {
    await ready;
    self.postMessage({ result: planFlows(data, calculateThroughput(data)) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
