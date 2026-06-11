import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../store/AuthContext';
import { Signal, Shield, Zap, Globe, Mail, User, Lock, Eye, EyeOff, AlertCircle, Phone } from 'lucide-react';

// Simple math CAPTCHA
function generateCaptcha() {
  const a = Math.floor(Math.random() * 20) + 1;
  const b = Math.floor(Math.random() * 20) + 1;
  return { question: `${a} + ${b} = ?`, answer: a + b };
}

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [captcha, setCaptcha] = useState(generateCaptcha);
  const [captchaInput, setCaptchaInput] = useState('');
  const [captchaError, setCaptchaError] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setCaptchaError(false);
    if (!username.trim()) { setError('Please enter username'); return; }
    if (!password.trim()) { setError('Please enter password'); return; }
    if (parseInt(captchaInput) !== captcha.answer) { setCaptchaError(true); setCaptcha(generateCaptcha); setCaptchaInput(''); return; }
    setLoading(true);
    await new Promise(r => setTimeout(r, 400));
    const result = await login(username.trim(), password);
    setLoading(false);
    if (result.success) { navigate('/', { replace: true }); }
    else { setError(result.error || 'Invalid credentials'); setCaptcha(generateCaptcha); setCaptchaInput(''); }
  };

  const refreshCaptcha = () => { setCaptcha(generateCaptcha()); setCaptchaInput(''); setCaptchaError(false); };

  const protocols = [
    { icon: <Shield size={20} className="text-blue-400" />, label: 'SMPP' },
    { icon: <Zap size={20} className="text-blue-400" />, label: 'HTTP' },
    { icon: <Globe size={20} className="text-blue-400" />, label: 'WhatsApp' },
    { icon: <Mail size={20} className="text-blue-400" />, label: 'RCS' },
    { icon: <Phone size={20} className="text-blue-400" />, label: 'Voice OTP' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 flex items-center justify-center p-4 overflow-hidden">
      {/* Background animated particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(20)].map((_, i) => (
          <div key={i} className="absolute rounded-full bg-blue-500/10 animate-pulse"
            style={{
              width: Math.random() * 100 + 20 + 'px', height: Math.random() * 100 + 20 + 'px',
              left: Math.random() * 100 + '%', top: Math.random() * 100 + '%',
              animationDelay: Math.random() * 5 + 's', animationDuration: Math.random() * 8 + 4 + 's',
            }} />
        ))}
      </div>

      <div className="relative w-full max-w-6xl flex flex-col lg:flex-row items-center gap-8 lg:gap-12 z-10">
        {/* Left - Brand Section with animations */}
        <div className="hidden lg:flex flex-1 flex-col items-center text-center">
          <div className="bg-blue-500/20 p-6 rounded-3xl mb-6 animate-bounce" style={{ animationDuration: '3s' }}>
            <Signal size={80} className="text-blue-400" />
          </div>
          <h1 className="text-4xl font-bold text-white mb-3">
            <span className="animate-pulse inline-block" style={{ animationDuration: '2s' }}>N</span>
            <span className="animate-pulse inline-block" style={{ animationDelay: '0.1s', animationDuration: '2s' }}>e</span>
            <span className="animate-pulse inline-block" style={{ animationDelay: '0.2s', animationDuration: '2s' }}>t</span>
            <span className="animate-pulse inline-block" style={{ animationDelay: '0.3s', animationDuration: '2s' }}>2</span>
            <span className="animate-pulse inline-block" style={{ animationDelay: '0.4s', animationDuration: '2s' }}>A</span>
            <span className="animate-pulse inline-block" style={{ animationDelay: '0.5s', animationDuration: '2s' }}>p</span>
            <span className="animate-pulse inline-block" style={{ animationDelay: '0.6s', animationDuration: '2s' }}>p</span>
            <span> </span>
            <span className="animate-pulse inline-block" style={{ animationDelay: '0.7s', animationDuration: '2s' }}>H</span>
            <span className="animate-pulse inline-block" style={{ animationDelay: '0.8s', animationDuration: '2s' }}>u</span>
            <span className="animate-pulse inline-block" style={{ animationDelay: '0.9s', animationDuration: '2s' }}>b</span>
          </h1>
          <p className="text-blue-200 text-lg mb-8">Enterprise SMS Platform</p>
          
          {/* Protocol badges with animation */}
          <div className="flex flex-wrap items-center justify-center gap-4">
            {protocols.map((proto, i) => (
              <div key={i} className="flex items-center gap-2 bg-white/10 rounded-xl px-4 py-2 border border-white/20 backdrop-blur-sm hover:bg-white/20 transition-all animate-fade-in"
                style={{ animationDelay: `${i * 0.2}s` }}>
                {proto.icon}
                <span className="text-blue-200 text-sm font-medium">{proto.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right - Login Form with CAPTCHA */}
        <div className="w-full max-w-md bg-white/10 backdrop-blur-xl rounded-2xl p-8 border border-white/20">
          <div className="lg:hidden text-center mb-6">
            <div className="bg-blue-500/20 p-3 rounded-2xl inline-block mb-3"><Signal size={32} className="text-blue-400" /></div>
            <h1 className="text-2xl font-bold text-white">Net2App Hub</h1>
          </div>
          <Signal size={36} className="text-blue-400 mx-auto mb-4 hidden lg:block" />
          <h2 className="text-2xl font-bold text-white text-center mb-1">Welcome Back</h2>
          <p className="text-blue-200 text-sm text-center mb-6">Sign in to your account</p>

          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg flex items-start gap-2">
              <AlertCircle size={18} className="text-red-300 shrink-0 mt-0.5" />
              <p className="text-sm text-red-200">{error}</p>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-blue-200 mb-2">Username</label>
              <div className="relative">
                <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-400" />
                <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter username" autoFocus autoComplete="username" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-blue-200 mb-2">Password</label>
              <div className="relative">
                <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-400" />
                <input type={showPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  className="w-full pl-10 pr-12 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter password" autoComplete="current-password" />
                <button type="button" onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400 hover:text-blue-200 transition-colors">
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* CAPTCHA */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <div className="flex items-center gap-3">
                <div className="bg-blue-500/20 rounded-lg px-4 py-2 text-center min-w-[80px]">
                  <span className="text-white text-lg font-bold font-mono tracking-wider select-none" style={{ textDecoration: 'line-through', textDecorationColor: 'rgba(255,255,255,0.3)' }}>
                    {captcha.question.replace(' = ?', '')}
                  </span>
                </div>
                <input type="text" value={captchaInput} onChange={e => { setCaptchaInput(e.target.value); setCaptchaError(false); }}
                  className="flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-center font-mono text-lg placeholder-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Answer" maxLength={3} />
                <button type="button" onClick={refreshCaptcha}
                  className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-blue-300 transition-colors" title="Refresh CAPTCHA">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
                </button>
              </div>
              {captchaError && <p className="text-red-400 text-xs mt-2 flex items-center gap-1"><AlertCircle size={12} /> Incorrect answer, please try again</p>}
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-medium rounded-xl transition-all disabled:opacity-50 transform hover:scale-[1.01] active:scale-[0.99]">
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
            <p className="text-center text-blue-300/60 text-[11px]">© 2024 Tri Angle Trade Centre FZE LLC</p>
          </form>
        </div>
      </div>
    </div>
  );
};
