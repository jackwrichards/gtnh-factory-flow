import { ImageResponse } from "next/og";

export const alt = "GTNH Planner - factory planner for GregTech: New Horizons";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The Discord/Twitter link preview card. Rendered server-side so it needs no
 * static asset, and restyled here rather than screenshotted so it stays sharp
 * at every embed size.
 */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "72px 80px",
          backgroundColor: "#101418",
          backgroundImage:
            "linear-gradient(rgba(56,189,248,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.07) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          color: "#f8fafc",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 30,
            fontWeight: 700,
            color: "#22d3ee",
            letterSpacing: 4,
            textTransform: "uppercase",
          }}
        >
          gtnhplanner.com
        </div>
        <div style={{ display: "flex", fontSize: 92, fontWeight: 800, marginTop: 18 }}>
          GTNH Planner
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 38,
            marginTop: 18,
            color: "#cbd5e1",
            lineHeight: 1.35,
          }}
        >
          Factory planner for GregTech: New Horizons. Draw production chains,
          balance machines, find bottlenecks, share plans.
        </div>
        <div style={{ display: "flex", gap: 20, marginTop: 44 }}>
          <div
            style={{
              display: "flex",
              padding: "14px 28px",
              borderRadius: 10,
              backgroundColor: "rgba(34,211,238,0.14)",
              border: "2px solid #22d3ee",
              color: "#67e8f9",
              fontSize: 32,
              fontWeight: 700,
            }}
          >
            GTNH 2.9 ready
          </div>
          <div
            style={{
              display: "flex",
              padding: "14px 28px",
              borderRadius: 10,
              backgroundColor: "rgba(148,163,184,0.12)",
              border: "2px solid #475569",
              color: "#cbd5e1",
              fontSize: 32,
              fontWeight: 600,
            }}
          >
            2.8.4 supported
          </div>
          <div
            style={{
              display: "flex",
              padding: "14px 28px",
              borderRadius: 10,
              backgroundColor: "rgba(74,222,128,0.12)",
              border: "2px solid #4ade80",
              color: "#86efac",
              fontSize: 32,
              fontWeight: 600,
            }}
          >
            Community plans
          </div>
        </div>
      </div>
    ),
    size,
  );
}
