// takumi-motion — react/data.ts (v0.9 Bet A)
// The data channel: "the animation knows the numbers".
//
// renderReactBanner({ data }) / CLI --data metrics.json load ONE data object
// before capture and hand it to the component tree through DataContext —
// chart components read it with useChartData(). The contract that keeps the
// determinism doctrine intact:
//
//   • data is loaded ONCE, at setup (a file read, never a network fetch at
//     render time — remote data would make bytes depend on the network);
//   • render stays a pure function of (frame, data) — the same data + frame
//     MUST reproduce byte-identical output;
//   • a `data` prop on a chart component always wins over the context, so a
//     scene can overlay its own numbers while the banner reads the file.

import { createContext, useContext } from "react";

/** Holds whatever the caller passed as `data` (undefined = nothing provided). */
export const DataContext = createContext<unknown>(undefined);

/**
 * Read the banner's data object. Throws with a pointed message when nothing
 * was provided — the usual fix is `renderReactBanner({ data })` or the CLI's
 * `--data metrics.json`.
 *
 * ```tsx
 * const data = useChartData<Metrics>();
 * <LineChart data={data.revenue} />
 * ```
 */
export function useChartData<T = unknown>(hint?: string): T {
  const data = useContext(DataContext);
  if (data === undefined) {
    throw new Error(
      "useChartData: no data was provided to this banner. " +
      "Pass `data` to renderReactBanner()/captureReactBanner(), or `--data file.json` on the CLI" +
      (hint ? ` (wanted for ${hint}).` : "."),
    );
  }
  return data as T;
}

/** True when a data object is present (lets components fall back gracefully). */
export function hasChartData(): boolean {
  return useContext(DataContext) !== undefined;
}
