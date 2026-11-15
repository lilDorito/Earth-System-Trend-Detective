// mock API with a small fake delay

import type { Api } from "../client";
import { analyze } from "./analysis";
import { demos, regions, regionTypes, variables } from "./catalog";
import { trendCo2 } from "./co2";
import { stationCompare, stations } from "./stations";
import { trendFrames, trendGlobalMean, trendGrid, trendMeta, trendPoint, trendRegion, trendVariables, trendWind } from "./trendmap";

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
  health: () => respond(() => ({ status: "ok", data_mode: "mock", variables: variables.length })),
  variables: () => respond(() => variables),
  regions: () => respond(() => regions),
  regionTypes: () => respond(() => regionTypes),
  demos: () => respond(() => demos),
  trendVariables: () => respond(trendVariables),
  trendMeta: () => respond(trendMeta),
  trendGrid: () => respond(trendGrid, 400),
  trendGlobalMean: () => respond(trendGlobalMean),
  trendFrames: (_, kind) => respond(() => trendFrames(kind), 400),
  trendWind: () => respond(trendWind),
  // the insights run on the real dataset only
  insightScan: () => unavailable(),
  insightDiagnose: () => unavailable(),
  insightScenarios: () => respond(() => []),
  trendCo2: () => respond(trendCo2),
  insightHotspots: () => unavailable(),
  insightDivergence: () => unavailable(),
  trendRegion: (_, region) => respond(() => trendRegion(region)),
  trendPoint: (_, lat, lon) => respond(() => trendPoint(lat, lon)),
  stations: (element) => respond(() => stations(element), 300),
  stationCompare: (id, variable, element) => respond(() => stationCompare(id, variable, element)),
  analyze: (body) => respond(() => analyze(body), 500),
};
