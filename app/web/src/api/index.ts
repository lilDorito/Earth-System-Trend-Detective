// picks the mock or the real API

import { httpApi } from "./client";
import { mockApi } from "./mock";

export const usingMockData = import.meta.env.VITE_DATA_SOURCE !== "api";

export const api = usingMockData ? mockApi : httpApi;
