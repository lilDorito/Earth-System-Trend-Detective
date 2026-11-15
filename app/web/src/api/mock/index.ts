// mock API with a small fake delay

import type { Api } from "../client";
import type { FlowField } from "../types";
import { trendCo2 } from "./co2";
import { stationCompare, stations } from "./stations";
import { trendFrames, trendGlobalMean, trendGrid, trendMeta, trendPoint, trendRegion, trendVariables, trendFlow } from "./trendmap";

function respond<T>(produce: () => T, latency = 250): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(produce());
      } catch (e) {
        reject(e);
      }
    }, latency + Math.random() * latency);
  });
}

const unavailable = () => Promise.reject(new Error("Needs the real dataset: run with VITE_DATA_SOURCE=api"));

export const mockApi: Api = {
  health: () => respond(() => ({ status: "ok", data_mode: "mock", variables: 1 })),
  trendVariables: () => respond(trendVariables),
  trendMeta: () => respond(trendMeta),
  trendGrid: () => respond(trendGrid, 400),
  trendGlobalMean: () => respond(trendGlobalMean),
  trendFrames: (_, kind) => respond(() => trendFrames(kind), 400),
  trendFlow: (field: FlowField) => respond(() => trendFlow(field)),
  // the insights run on the real dataset only
  insightScan: () => unavailable(),
  insightDiagnose: () => unavailable(),
  trendCo2: () => respond(trendCo2),
  trendRegion: (_, region) => respond(() => trendRegion(region)),
  trendPoint: (_, lat, lon) => respond(() => trendPoint(lat, lon)),
  stations: (element) => respond(() => stations(element), 300),
  stationCompare: (id, variable, element) => respond(() => stationCompare(id, variable, element)),
};
