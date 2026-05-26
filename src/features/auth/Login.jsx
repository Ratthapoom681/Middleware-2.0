import { useState } from 'react';
import { ShieldAlert, LogIn } from 'lucide-react';
import { API_BASE, removeAuthToken, removeCurrentUser, setAuthToken, setCurrentUser } from '../../shared/api/api';
import ThemeToggle from '../../shared/ui/ThemeToggle';

const Login = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 10 }}>
        <ThemeToggle />
      </div>
      <div className="login-card">
        <div className="login-header">
          <ShieldAlert size={48} color="var(--primary)" />
          <h2>Security Dashboard</h2>
          <p>Sign in to access findings</p>
        </div>
        
        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="login-error" role="alert">{error}</div>}
          
          <div className="form-group">
            <label htmlFor="login-username">Username</label>
            <input 
              id="login-username"
              type="text" 
              value={username} 
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              required
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="login-password">Password</label>
            <input 
              id="login-password"
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              required
            />
          </div>
          
          <button type="submit" className="btn-primary login-btn" disabled={loading}>
            {loading ? <div className="spinner"></div> : <LogIn size={18} />}
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
