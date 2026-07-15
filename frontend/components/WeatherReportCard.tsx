import type { WeatherReport } from "@/lib/tee/instruction";

export function WeatherReportCard({ report }: { report: WeatherReport }) {
  return (
    <dl className="mt-4 grid gap-2 rounded-xl bg-white p-4 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-flare-subtle">City</dt>
        <dd className="font-medium">
          {report.city}, {report.country}
        </dd>
      </div>
      <div>
        <dt className="text-flare-subtle">Conditions</dt>
        <dd>{report.description}</dd>
      </div>
      <div>
        <dt className="text-flare-subtle">Temperature</dt>
        <dd>
          {report.tempC}°C (feels {report.feelsLikeC}°C)
        </dd>
      </div>
      <div>
        <dt className="text-flare-subtle">Wind / humidity</dt>
        <dd>
          {report.windMS} m/s · {report.humidityPct}%
        </dd>
      </div>
    </dl>
  );
}
