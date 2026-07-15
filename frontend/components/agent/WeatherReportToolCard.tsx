import type { WeatherReport } from "@/lib/tee/instruction";

import { WeatherReportCard } from "@/components/WeatherReportCard";

export function WeatherReportToolCard({ report }: { report: WeatherReport }) {
  return (
    <div className="mt-2 rounded-xl border border-flare-border bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-flare-subtle">
        TEE weather report
      </p>
      <WeatherReportCard report={report} />
    </div>
  );
}
