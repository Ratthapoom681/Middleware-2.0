import { useState } from "react";
import { API_BASE, removeAuthToken, removeCurrentUser, setAuthToken, setCurrentUser } from "../../shared/api/api";
import "./LoginPage.css";

function EyeOpenIcon() {
  return (
    <>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </>
  );
}

function EyeClosedIcon() {
  return (
    <>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" strokeLinecap="round" />
    </>
  );
}

function BrandIllustration() {
  const dbRows = [
    { y: 120, w1: 30, w2: 35 },
    { y: 60,  w1: 35, w2: 27 },
    { y: 0,   w1: 27, w2: 42 },
  ];

  return (
    <svg className="brand-illustration" viewBox="0 0 560 380" fill="none"
      xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shieldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#5B2EA6" />
          <stop offset="100%" stopColor="#8B5CF6" />
        </linearGradient>
        <linearGradient id="dbGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#1A3A6B" />
          <stop offset="100%" stopColor="#0F2040" />
        </linearGradient>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Ground shadow */}
      <ellipse cx="280" cy="355" rx="220" ry="12" fill="#111122" />

      {/* Background connector lines */}
      <path d="M115 210 Q280 210, 280 200" stroke="#1E1E38" strokeWidth="1.5" fill="none" />
      <path d="M280 200 Q280 210, 440 210" stroke="#1E1E38" strokeWidth="1.5" fill="none" />

      {/* Left node — browser */}
      <g transform="translate(60,130)">
        <rect x="0" y="0" width="110" height="150" rx="14" fill="#111126" stroke="#1E2A50" strokeWidth="1.5" />
        <rect x="0" y="0" width="110" height="26" rx="14" fill="#1A3A6B" />
        <circle cx="15" cy="13" r="4" fill="#fff" opacity="0.35" />
        <circle cx="27" cy="13" r="4" fill="#fff" opacity="0.35" />
        <circle cx="39" cy="13" r="4" fill="#fff" opacity="0.35" />
        <rect x="15" y="42" width="80" height="8" rx="4" fill="#1E2A50" />
        <rect x="15" y="60" width="60" height="6" rx="3" fill="#161830" />
        <rect x="15" y="74" width="70" height="6" rx="3" fill="#161830" />
        <path d="M35 110 L25 118 L35 126" stroke="#4A7CC7" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M55 110 L65 118 L55 126" stroke="#4A7CC7" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <line x1="48" y1="108" x2="42" y2="128" stroke="#4A7CC7" strokeWidth="2.5"
          strokeLinecap="round" />
      </g>

      {/* Centre — middleware shield */}
      <g transform="translate(240,100)">
        <path d="M40 0 L75 12 V44 C75 72, 40 88, 40 88 C40 88, 5 72, 5 44 V12 Z"
          stroke="#7B4FD4" strokeWidth="1.5" strokeDasharray="4 3" fill="none"
          transform="scale(1.1) translate(-3.5,-4)" opacity="0.5" />
        <path d="M40 0 L75 12 V44 C75 72, 40 88, 40 88 C40 88, 5 72, 5 44 V12 Z"
          fill="url(#shieldGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="2"
          filter="url(#glow)" />
        <path
          d="M40 22 C34 22,29 27,29 33 V39 H51 V33 C51 27,46 22,40 22 Z
             M24 39 H56 C58 39,60 41,60 43 V58 C60 60,58 62,56 62
             H24 C22 62,20 60,20 58 V43 C20 41,22 39,24 39 Z"
          fill="rgba(255,255,255,0.85)" />
        <circle cx="40" cy="50" r="3" fill="#5B2EA6" />
        <path d="M40 50 L40 57" stroke="#5B2EA6" strokeWidth="2" strokeLinecap="round" />
      </g>

      {/* Blocked request */}
      <path d="M170 190 Q210 190, 230 220" stroke="#E24B4A" strokeWidth="3"
        strokeDasharray="5 5" fill="none" />
      <circle cx="230" cy="220" r="8" fill="#E24B4A" />
      <path d="M227 217 L233 223 M233 217 L227 223" stroke="#fff"
        strokeWidth="2" strokeLinecap="round" />

      {/* Authorized request */}
      <path d="M170 170 Q210 170, 246 160" stroke="#1D9E75" strokeWidth="3"
        strokeDasharray="6 4" fill="none" />
      <circle cx="210" cy="167" r="6" fill="#1D9E75" />
      <path d="M208 167 L210 169 L213 165" stroke="#fff" strokeWidth="1.5"
        fill="none" strokeLinecap="round" />

      {/* Verified → DB */}
      <path d="M315 160 Q360 170, 400 180" stroke="#1D9E75" strokeWidth="3" fill="none" />
      <circle cx="360" cy="170" r="6" fill="#1D9E75" />
      <path d="M358 170 L360 172 L363 168" stroke="#fff" strokeWidth="1.5"
        fill="none" strokeLinecap="round" />

      {/* Right node — stacked databases */}
      <g transform="translate(400,100)">
        {dbRows.map(({ y, w1, w2 }, i) => (
          <g key={i} transform={`translate(0,${y})`}>
            <path d="M0 15 C0 5,80 5,80 15 V45 C80 55,0 55,0 45 Z"
              fill="url(#dbGrad)" stroke="#1E2A50" strokeWidth="1" />
            <ellipse cx="40" cy="15" rx="40" ry="10"
              fill="#0F1830" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
            <line x1="15" y1="32" x2={15 + w1} y2="32"
              stroke="rgba(255,255,255,0.25)" strokeWidth="3" strokeLinecap="round" />
            <line x1="15" y1="40" x2={15 + w2} y2="40"
              stroke="rgba(255,255,255,0.25)" strokeWidth="3" strokeLinecap="round" />
            <circle cx="65" cy="35" r="3" fill="#1D9E75" />
          </g>
        ))}
      </g>

      {/* Left character — operator */}
      <g>
        <rect x="175" y="295" width="30" height="8" rx="4" fill="#2A2A3A" />
        <line x1="182" y1="303" x2="175" y2="360" stroke="#2A2A3A" strokeWidth="4" />
        <line x1="198" y1="303" x2="205" y2="360" stroke="#2A2A3A" strokeWidth="4" />
        <path d="M192 260 L215 290 L220 340" stroke="#2D1500" strokeWidth="8"
          strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M180 260 L200 288 L195 340" stroke="#2D1500" strokeWidth="8"
          strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <rect x="160" y="195" width="44" height="65" rx="16" fill="#5B2EA6" />
        <path d="M172 195 L182 208 L192 195" fill="rgba(255,255,255,0.08)" />
        <circle cx="182" cy="165" r="18" fill="#F3D2C1" />
        <path d="M164 165 C164 150,200 150,200 165 C200 155,172 153,164 165 Z"
          fill="#1A0A00" />
        <circle cx="194" cy="170" r="8" fill="#1A0A00" />
        <path d="M175 215 L210 220 L205 238" stroke="#F3D2C1" strokeWidth="7"
          strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M205 238 L235 238 L240 218" stroke="#2A2A3A" strokeWidth="4"
          strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <polygon points="205,238 235,238 232,243 203,243" fill="#1A1A2E" />
      </g>

      {/* Right character — analyst */}
      <g>
        <rect x="350" y="275" width="10" height="80" rx="5" fill="#1E2230" />
        <rect x="368" y="275" width="10" height="80" rx="5" fill="#1E2230" />
        <rect x="342" y="350" width="20" height="10" rx="5" fill="#111120" />
        <rect x="366" y="350" width="20" height="10" rx="5" fill="#111120" />
        <rect x="332" y="185" width="54" height="95" rx="18" fill="#C05800" />
        <circle cx="359" cy="155" r="19" fill="#E0AC9D" />
        <path d="M340 150 C340 135,378 135,378 150 H340 Z" fill="#0D0D1A" />
        <rect x="348" y="152" width="12" height="8" rx="2" fill="none"
          stroke="#0D0D1A" strokeWidth="2" />
        <rect x="362" y="152" width="12" height="8" rx="2" fill="none"
          stroke="#0D0D1A" strokeWidth="2" />
        <line x1="360" y1="156" x2="362" y2="156" stroke="#0D0D1A" strokeWidth="2" />
        <path d="M342 205 L315 200 C310 199,310 195,315 195" stroke="#E0AC9D"
          strokeWidth="8" strokeLinecap="round" fill="none" />
        <path d="M376 205 L395 235 L390 245" stroke="#E0AC9D" strokeWidth="8"
          strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </g>

      {/* Floor router */}
      <g transform="translate(10,310)">
        <rect x="0" y="8" width="45" height="38" rx="6" fill="#1A3A6B" />
        <rect x="-2" y="0" width="49" height="10" rx="4" fill="#0F2040" />
        <line x1="12" y1="20" x2="33" y2="20" stroke="rgba(255,255,255,0.3)"
          strokeWidth="3" strokeLinecap="round" />
        <line x1="12" y1="28" x2="25" y2="28" stroke="rgba(255,255,255,0.3)"
          strokeWidth="3" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export default function LoginPage({ onLoginSuccess }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSignIn(e) {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setError("");
    removeAuthToken();
    removeCurrentUser();

    try {
      const response = await fetch(`${API_BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Unable to sign in");
      }

      if (!data.token || !data.user) {
        throw new Error("Login response was missing session data");
      }

      setAuthToken(data.token);
      setCurrentUser(data.user);
      onLoginSuccess?.(data.user);
    } catch (err) {
      setError(err.message || "Unable to sign in");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-container login-page">

      {/* ── LEFT: LOGIN CARD ── */}
      <div className="left-panel">
        <div className="glow-blob glow-blob-1" />
        <div className="glow-blob glow-blob-2" />

        <div className="glass-card">
          <div className="card-header">
            <h1 className="card-title">Welcome</h1>
            <p className="card-subtitle">Please enter your credentials below</p>
          </div>

          <form onSubmit={handleSignIn}>
            {error && (
              <div className="login-error" role="alert">
                {error}
              </div>
            )}

            {/* Username */}
            <div className="form-group">
              <label className="form-label" htmlFor="username">Username</label>
              <div className="input-wrapper">
                <input
                  type="text"
                  id="username"
                  className="form-input"
                  placeholder="Enter Username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                  autoComplete="username"
                  disabled={loading}
                  aria-invalid={Boolean(error)}
                />
              </div>
            </div>

            {/* Password */}
            <div className="form-group">
              <label className="form-label" htmlFor="password">Password</label>
              <div className="input-wrapper">
                <input
                  type={showPassword ? "text" : "password"}
                  id="password"
                  className="form-input password-input"
                  placeholder="Enter Password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  autoComplete="current-password"
                  disabled={loading}
                  aria-invalid={Boolean(error)}
                />
                <button
                  type="button"
                  className="toggle-password"
                  onClick={() => setShowPassword(v => !v)}
                  disabled={loading}
                  aria-label="Toggle password visibility"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round">
                    {showPassword ? <EyeClosedIcon /> : <EyeOpenIcon />}
                  </svg>
                </button>
              </div>
            </div>

            {/* Submit */}
            <button type="submit" className="btn-submit" disabled={loading}>
              {loading && <span className="spinner" />}
              <span>{loading ? "Authenticating…" : "Sign In"}</span>
            </button>
          </form>
        </div>
      </div>

      {/* ── RIGHT: BRAND PANEL ── */}
      <div className="right-panel">
        <div className="blue-ellipse-bg" />

        <div className="brand-header">
          <h2 className="brand-title">INTERNAL SECURITY</h2>
          <div className="brand-subtitle-row">
            <span className="brand-shield">
              <svg width="42" height="42" viewBox="0 0 24 24">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="#4A7CC7" />
                <path d="M9 11l2 2 4-4" stroke="#fff" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </span>
            <span className="brand-subtext">MIDDLEWARE</span>
          </div>
        </div>
        <div className="illustration-container">
          <BrandIllustration />
        </div>
      </div>

    </div>
  );
}
