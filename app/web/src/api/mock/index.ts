// mock API with a small fake delay

import type { Api } from "../client";
import { analyze } from "./analysis";
import { demos, regions, regionTypes, variables } from "./catalog";
import { trendGlobalMean, trendGrid, trendMeta, trendPoint } from "./trendmap";

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

export const mockApi: Api = {
  health: () => respond(() => ({ status: "ok", data_mode: "mock", variables: variables.length })),
  variables: () => respond(() => variables),
  regions: () => respond(() => regions),
  regionTypes: () => respond(() => regionTypes),
  demos: () => respond(() => demos),
  trendMeta: () => respond(trendMeta),
  trendGrid: () => respond(trendGrid, 400),
  trendGlobalMean: () => respond(trendGlobalMean),
  trendPoint: (lat, lon) => respond(() => trendPoint(lat, lon)),
  analyze: (body) => respond(() => analyze(body), 500),
};
