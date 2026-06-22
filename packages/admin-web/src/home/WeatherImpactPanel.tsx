import type { OperatingArea } from "./homeRoles";
import { HomeSectionHeader } from "./homeShared";

// June 18 feedback — Weather is honestly unavailable. No forecast provider/API and no credentials are
// connected, and the only weather-adjacent signal in the codebase is a TRAVEL heuristic (drive time /
// student load), which must NOT be presented as weather. So this panel shows a single honest
// "Weather provider not connected" state: NO count, NO fabricated forecast rows, NO drilldown/CTA,
// and no fallback to demo data. When a provider is wired, this becomes a real affected-shoots list.
//
// Future integration requirements (documented, not implemented here):
//   - a forecast provider + API credentials (server-side, never exposed to the client)
//   - canonical upcoming-Shoot coordinates (shoot_location lat/lng) to query by location
//   - a forecast freshness window + a server cache policy (provider timestamp surfaced to the UI)
//   - explicit stale/error behavior (never silently show old or demo data)
//   - affected-Shoot derivation (map a forecast concern to the exact Shoot ids + a deep link)
//   - operational thresholds (rain, lightning, high wind, extreme heat/cold, snow/ice, provider alert)

// emphasizedArea is accepted for layout-parity with the other home panels; nothing is ranked because
// there is no real weather data to order.
export function WeatherImpactPanel(_props: { emphasizedArea: OperatingArea }) {
  return (
    <section className="panel home-weather home-weather--unavailable" aria-label="Weather impact">
      <HomeSectionHeader
        title="Weather Impact"
        help="Weather tied to specific shoots. Connected to a forecast provider, this shows which upcoming shoots are at risk and links to each affected shoot."
      />
      <div className="home-weather__notconnected" role="note">
        <span className="home-command-card__badge home-command-card__badge--off">Not connected</span>
        <p>
          <strong>Weather provider not connected.</strong> No forecast source is configured, so there
          is no live weather count and no affected-shoot list. Travel-pressure signals are tracked
          separately and are never shown here as weather.
        </p>
      </div>
    </section>
  );
}
