export default function AuthBackground({ idPrefix }) {
  const outboundRouteId = `${idPrefix}-network-route-outbound`;
  const returnRouteId = `${idPrefix}-network-route-return`;

  return (
    <div className="security-background" aria-hidden="true">
      <div className="security-halo" />
      <div className="edge-glow edge-glow-left" />
      <div className="edge-glow edge-glow-right" />
      <div className="security-grid" />

      <svg
        className="security-network"
        viewBox="0 0 1440 900"
        preserveAspectRatio="none"
        focusable="false"
      >
        <defs>
          <path
            id={outboundRouteId}
            d="M105 160L220 225L350 450H1090L1210 210L1325 135"
          />
          <path
            id={returnRouteId}
            d="M1125 760L1230 600L1090 450H350L205 575L315 740"
          />
        </defs>

        <g className="network-lines" fill="none">
          <path d="M105 160L220 225" />
          <path d="M105 160L178 355" />
          <path d="M220 225L178 355" />
          <path d="M220 225L350 450" />
          <path d="M178 355L350 450" />
          <path d="M178 355L205 575" />
          <path d="M205 575L350 450" />
          <path d="M205 575L315 740" />

          <path className="network-bridge" d="M350 450H1090" />

          <path d="M1090 450L1210 210" />
          <path d="M1090 450L1260 380" />
          <path d="M1090 450L1230 600" />
          <path d="M1210 210L1325 135" />
          <path d="M1210 210L1260 380" />
          <path d="M1260 380L1230 600" />
          <path d="M1230 600L1125 760" />
        </g>

        <g className="network-nodes">
          <circle cx="105" cy="160" r="4" />
          <circle cx="220" cy="225" r="5" />
          <circle cx="178" cy="355" r="3.5" />
          <circle cx="205" cy="575" r="5" />
          <circle
            className="network-node-arrival network-node-arrival-return"
            cx="315"
            cy="740"
            r="3.5"
          />
          <circle cx="350" cy="450" r="4.5" />

          <circle cx="1090" cy="450" r="4.5" />
          <circle
            className="network-node-arrival network-node-arrival-outbound"
            cx="1325"
            cy="135"
            r="4"
          />
          <circle cx="1210" cy="210" r="5" />
          <circle cx="1260" cy="380" r="3.5" />
          <circle cx="1230" cy="600" r="5" />
          <circle cx="1125" cy="760" r="3.5" />
        </g>

        <g className="network-packets">
          <g className="network-packet network-packet-outbound">
            <circle className="network-packet-glow" r="8" />
            <circle className="network-packet-core" r="3" />
            <animateMotion dur="12s" begin="0s" repeatCount="indefinite">
              <mpath href={`#${outboundRouteId}`} />
            </animateMotion>
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              keyTimes="0;0.05;0.94;1"
              dur="12s"
              begin="0s"
              repeatCount="indefinite"
            />
          </g>

          <g className="network-packet network-packet-return">
            <circle className="network-packet-glow" r="8" />
            <circle className="network-packet-core" r="3" />
            <animateMotion dur="12s" begin="-5s" repeatCount="indefinite">
              <mpath href={`#${returnRouteId}`} />
            </animateMotion>
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              keyTimes="0;0.05;0.94;1"
              dur="12s"
              begin="-5s"
              repeatCount="indefinite"
            />
          </g>
        </g>
      </svg>

      <div className="security-vignette" />
    </div>
  );
}
