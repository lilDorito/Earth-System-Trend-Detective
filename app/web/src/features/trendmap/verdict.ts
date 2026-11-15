// the answer to "Is Earth okay?" for one trend: "Not really okay: +0.4 °C per decade" or "Looks fine here"

import { formatSigned } from "@/lib/format";

// which way of changing is a worry: 1 rising, -1 falling, 0 neither (rain, wind: a change either way matters,
// but neither is plainly bad)
const WORRY: Record<string, 1 | -1 | 0> = {
  merra2_t2m: 1,
  merra2_ts: 1,
  gldas_tair: 1,
  gldas_skin_temp: 1,
  sst: 1,
  ohc_0_700: 1,
  ohc_0_2000: 1,
  sla: 1,
  ocean_mass: 1,
  pco2: 1,
  aod: 1,
  burned_area: 1,
  gldas_potevap: 1,
  sea_ice_conc: -1,
  gldas_swe: -1,
  gldas_snowdepth: -1,
  ph: -1,
  to3: -1,
  ndvi: -1,
  gldas_soilmoist_0_10: -1,
  gldas_soilmoist_10_40: -1,
  gldas_rootmoist: -1,
};

export type Verdict = { tone: "bad" | "fine" | "change"; words: string; amount: string };

export function verdict(key: string, slopeDecade: number, significant: boolean, units: string): Verdict {
  const amount = `${formatSigned(slopeDecade)} ${units} per decade`;
  if (!significant || !Number.isFinite(slopeDecade) || slopeDecade === 0) return { tone: "fine", words: "Looks fine here", amount };
  const worry = WORRY[key] ?? 0;
  if (worry === 0) return { tone: "change", words: "Changing here", amount };
  return Math.sign(slopeDecade) === worry ? { tone: "bad", words: "Not really okay", amount } : { tone: "fine", words: "Looks fine here", amount };
}
