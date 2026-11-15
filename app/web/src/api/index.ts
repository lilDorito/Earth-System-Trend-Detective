// picks the mock or the real API

import { httpApi } from "./client";
import { mockApi } from "./mock";

export const usingMockData = import.meta.env.VITE_DATA_SOURCE !== "api";

export const api = usingMockData ? mockApi : httpApi;

// start waking the server as soon as the app opens, so it is up by the time a page asks for data
if (!usingMockData) void httpApi.health().catch(() => {});
