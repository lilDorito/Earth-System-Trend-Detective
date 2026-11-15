// whether the API is waking up: the free Render instance sleeps after 15 idle minutes and takes 30-60 s to start

import { create } from "zustand";

export const useServerStatus = create<{ waking: boolean }>(() => ({ waking: false }));

export const WAKING_MESSAGE = "Waking the server up: free hosting sleeps when idle, this takes up to a minute";
