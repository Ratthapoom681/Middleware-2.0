import { useState } from 'react';
import { ShieldCheck, LogIn, User, Lock, AlertCircle } from 'lucide-react';
import { API_BASE, removeAuthToken, removeCurrentUser, setAuthToken, setCurrentUser } from '../../shared/api/api';
import ThemeToggle from '../../shared/ui/ThemeToggle';
import ParticleBackground from './ParticleBackground';

const Login = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    removeAuthToken();
    removeCurrentUser();

    try {
      const response = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      setAuthToken(data.token);
      setCurrentUser(data.user);
      onLoginSuccess(data.user);
    } catch (err) {
      setError(err.message);
      setShake(true);
      setTimeout(() => setShake(false), 500);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <ParticleBackground />

      <div style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 10 }}>
        <ThemeToggle />
      </div>

      <div className={`login-card${shake ? ' login-card-shake' : ''}`}>
        {/* Glowing top border accent */}
        <div className="login-card-glow" aria-hidden="true" />

        <div className="login-header">
          <div className="login-icon-ring">
            <ShieldCheck size={32} />
          </div>
          <h2>Security Dashboard</h2>
          <p>Sign in to access vulnerability findings</p>
        </div>
        
        <form onSubmit={handleSubmit} className="login-form">
          {error && (
            <div className="login-error" role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}
          
          <div className="login-field">
            <div className="login-field-icon">
              <User size={18} />
            </div>
            <input 
              id="login-username"
              type="text" 
              value={username} 
              onChange={(e) => setUsername(e.target.value)}
              placeholder=" "
              required
              autoComplete="username"
            />
            <label htmlFor="login-username">Username</label>
          </div>
          
          <div className="login-field">
            <div className="login-field-icon">
              <Lock size={18} />
            </div>
            <input 
              id="login-password"
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)}
              placeholder=" "
              required
              autoComplete="current-password"
            />
            <label htmlFor="login-password">Password</label>
          </div>
          
          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? (
              <>
                <div className="login-spinner" />
                <span>Authenticating...</span>
              </>
            ) : (
              <>
                <LogIn size={18} />
                <span>Sign In</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
