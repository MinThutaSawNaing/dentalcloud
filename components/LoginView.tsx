import React, { useState, useEffect } from 'react';
import { Shield, Eye, EyeOff, RefreshCw, Lock, User, Building2, Mail, Calendar, FileText, ArrowLeft } from 'lucide-react';
import { auth } from '../services/auth';
import { otpService } from '../services/otp';
import PatientSelfRegistration from './PatientSelfRegistration';
import { APP_VERSION } from '../constants';

interface LoginViewProps {
  onLoginSuccess: () => void;
  appName?: string;
  appLogoUrl?: string;
}

type LoginMode = 'admin' | 'patient';

const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess, appName = '', appLogoUrl }) => {
  const lastForgotPasswordSubmitRef = React.useRef(0);
  const [loginMode, setLoginMode] = useState<LoginMode>('patient');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [captchaDigits, setCaptchaDigits] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showRegistration, setShowRegistration] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [isPreparingRecovery, setIsPreparingRecovery] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [confirmResetPassword, setConfirmResetPassword] = useState('');
  const logoSrc = appLogoUrl || '/assets/WinterArcLogo.png';


  useEffect(() => {
    document.documentElement.classList.add('auth-screen');
    return () => {
      document.documentElement.classList.remove('auth-screen');
    };
  }, []);

  // Generate new CAPTCHA
  const generateCaptcha = () => {
    const digits = Array.from({ length: 4 }, () => Math.floor(Math.random() * 10));
    setCaptchaDigits(digits);
    setCaptchaAnswer('');
  };

  useEffect(() => {
    generateCaptcha();

    const urlParams = new URLSearchParams(window.location.search);
    const resetCode = urlParams.get('code');
    const resetEmail = urlParams.get('email');

    if (urlParams.get('reset') === 'password') {
      setLoginMode('patient');
      setShowForgotPassword(false);
      setIsRecoveryMode(true);
      setIsPreparingRecovery(false);
      setError('');

      if (resetCode && resetEmail) {
        setForgotPasswordEmail(resetEmail);
        setInfoMessage('Reset link verified. Set your new password below to finish resetting your patient account.');
      } else {
        setError('This reset link is missing required information. Please request a new reset email.');
        setInfoMessage('');
      }
    }
  }, []);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfoMessage('');
    setLoading(true);

    try {
      // CAPTCHA required for both staff and patient login
      if (captchaAnswer.length !== 4 || !/^[0-9]{4}$/.test(captchaAnswer)) {
        setError('Please enter exactly 4 digits for CAPTCHA');
        setLoading(false);
        return;
      }

      const expected = parseInt(captchaDigits.join(''), 10);
      const enteredCaptcha = parseInt(captchaAnswer, 10);

      if (enteredCaptcha !== expected) {
        setError('Incorrect CAPTCHA. Please try again.');
        generateCaptcha();
        setLoading(false);
        return;
      }

      if (loginMode === 'admin') {
        await auth.login(username, password, enteredCaptcha, expected);
      } else {
        // Patient login (phone or name + password) with CAPTCHA
        await auth.patientLogin(username, password);
      }
      onLoginSuccess();
    } catch (err: any) {
      setError(err.message || 'Login failed. Please try again.');
      generateCaptcha(); // Regenerate CAPTCHA on error
    } finally {
      setLoading(false);
    }
  };

  const resetRecoveryState = () => {
    setIsRecoveryMode(false);
    setResetPassword('');
    setConfirmResetPassword('');
    setShowPassword(false);
    setError('');
    setInfoMessage('');
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
  };

  const handleForgotPasswordRequest = async (e: React.FormEvent) => {
    e.preventDefault();

    const now = Date.now();
    if (now - lastForgotPasswordSubmitRef.current < 1000) {
      return;
    }
    lastForgotPasswordSubmitRef.current = now;

    setError('');
    setInfoMessage('');
    setLoading(true);

    try {
      const result = await otpService.requestPasswordReset(forgotPasswordEmail);
      if (!result.success) {
        setError(result.message);
        return;
      }

      setInfoMessage(result.message);
    } catch (err: any) {
      setError(err.message || 'Failed to send password reset email.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordResetComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfoMessage('');

    if (resetPassword !== confirmResetPassword) {
      setError('New passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      const urlParams = new URLSearchParams(window.location.search);
      const result = await otpService.completePasswordReset(
        resetPassword,
        urlParams.get('email') || forgotPasswordEmail,
        urlParams.get('code') || undefined
      );
      if (!result.success) {
        setError(result.message);
        return;
      }

      auth.logout();
      resetRecoveryState();
      setLoginMode('patient');
      setPassword('');
      setUsername(result.email || forgotPasswordEmail || '');
      setForgotPasswordEmail('');
      setInfoMessage(result.message);
    } catch (err: any) {
      setError(err.message || 'Failed to reset password.');
    } finally {
      setLoading(false);
    }
  };

  // Handle registration completion
  const handleRegistrationComplete = () => {
    setShowRegistration(false);
    setLoginMode('patient');
    setError('');
    setInfoMessage('');
  };

  // Show registration form
  if (showRegistration) {
    return (
      <PatientSelfRegistration 
        onBack={() => {
          setShowRegistration(false);
        }}
        onRegistrationComplete={handleRegistrationComplete}
      />
    );
  }

  return (
    <div className="auth-safe-screen min-h-screen flex bg-gradient-to-br from-slate-50 via-blue-50 to-blue-100">
      {/* Left Panel - Branding */}
      <div
        className="hidden lg:flex lg:w-1/2 p-6 flex-col justify-between"
        style={{
          background: 'linear-gradient(135deg, var(--hover-700, #1d4ed8) 0%, var(--hover-600, #2563eb) 45%, #0f172a 100%)'
        }}
      >
        <div>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-14 h-14 bg-white overflow-hidden rounded-xl flex items-center justify-center border border-white/20 shadow-inner">
              <img src={logoSrc} alt="Clinic logo" className="w-full h-full object-contain" />
            </div>
            <h1 className="text-xl font-black tracking-tight bg-gradient-to-r from-blue-200 via-cyan-200 to-sky-300 bg-clip-text text-transparent">{appName}</h1>
          </div>
          
          <div className="max-w-xs">
            <h2 className="text-2xl font-black text-white mb-3 leading-tight">
              {loginMode === 'admin' 
                ? 'Professional Dental Practice Management' 
                : 'Patient Portal'}
            </h2>
            <p className="text-indigo-200 text-sm mb-6 leading-relaxed">
              {loginMode === 'admin' 
                ? 'Secure, reliable, and enterprise-grade solution for your clinic\'s operations.'
                : 'Access your personal dental records, appointments, and treatment history.'}
            </p>
            
            <div className="space-y-3">
              {loginMode === 'admin' ? (
                <>
                  <div className="flex items-start gap-2">
                    <div className="w-7 h-7 bg-indigo-700/30 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Shield className="w-3 h-3 text-indigo-300" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white text-xs">Enterprise Security</h3>
                      <p className="text-indigo-200 text-xs">Bank-level encryption and compliance</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-2">
                    <div className="w-7 h-7 bg-indigo-700/30 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Building2 className="w-3 h-3 text-indigo-300" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white text-xs">Multi-Location Support</h3>
                      <p className="text-indigo-200 text-xs">Manage multiple clinics from one platform</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-2">
                    <div className="w-7 h-7 bg-indigo-700/30 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Lock className="w-3 h-3 text-indigo-300" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white text-xs">HIPAA Compliant</h3>
                      <p className="text-indigo-200 text-xs">Secure patient data protection</p>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-2">
                    <div className="w-7 h-7 bg-indigo-700/30 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <User className="w-3 h-3 text-indigo-300" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white text-xs">Personal Health Records</h3>
                      <p className="text-indigo-200 text-xs">Access your complete treatment history</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-2">
                    <div className="w-7 h-7 bg-indigo-700/30 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Calendar className="w-3 h-3 text-indigo-300" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white text-xs">Appointment Management</h3>
                      <p className="text-indigo-200 text-xs">View and schedule your appointments</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-2">
                    <div className="w-7 h-7 bg-indigo-700/30 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <FileText className="w-3 h-3 text-indigo-300" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white text-xs">Secure & Private</h3>
                      <p className="text-indigo-200 text-xs">Your health data is protected</p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        
        <div className="text-indigo-300 text-xs">
          &copy; {new Date().getFullYear()} WinterArc Myanmar Company Limited. All rights reserved.
          <span className="mt-1 block">Version {APP_VERSION}</span>
        </div>
      </div>
      
      {/* Right Panel - Login Form */}
      <div className="auth-safe-panel w-full lg:w-1/2 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-white rounded-2xl mb-4 shadow-xl overflow-hidden border border-gray-100">
              <img src={logoSrc} alt="Clinic logo" className="w-full h-full object-contain" />
            </div>
            <h1 className="text-xl font-black text-gray-900 mb-2 tracking-tight">
              {isRecoveryMode ? 'Reset Patient Password' : loginMode === 'admin' ? 'Welcome Back' : 'Patient Login'}
            </h1>
            <p className="text-gray-600 font-medium text-sm">
              {isRecoveryMode
                ? 'Create a new password for your patient portal'
                : loginMode === 'admin' 
                ? `Sign in to your ${appName} account`
                : 'Access your patient dashboard'}
            </p>
            
            {/* Login Mode Toggle */}
            {!isRecoveryMode && (
              <div className="mt-4 flex bg-gray-100 rounded-lg p-1 max-w-xs mx-auto">
                <button
                  onClick={() => {
                    setLoginMode('patient');
                    setShowForgotPassword(false);
                    setError('');
                    setInfoMessage('');
                    generateCaptcha();
                  }}
                  className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                    loginMode === 'patient' 
                      ? 'bg-white text-indigo-600 shadow-sm' 
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Patient
                </button>
                <button
                  onClick={() => {
                    setLoginMode('admin');
                    setShowForgotPassword(false);
                    setError('');
                    setInfoMessage('');
                    generateCaptcha();
                  }}
                  className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                    loginMode === 'admin' 
                      ? 'bg-white text-indigo-600 shadow-sm' 
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Staff
                </button>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-6">
            {isRecoveryMode ? (
              <form onSubmit={handlePasswordResetComplete} className="space-y-4">
                <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
                  The reset link has been verified. Choose a new password to finish recovery.
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-2">
                    <Lock className="w-3 h-3 text-gray-500" />
                    NEW PASSWORD
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={resetPassword}
                      onChange={(e) => setResetPassword(e.target.value)}
                      placeholder="Enter your new password"
                      required
                      minLength={6}
                      className="w-full pl-9 pr-10 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all bg-gray-50 focus:bg-white text-sm"
                    />
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-2">
                    <Lock className="w-3 h-3 text-gray-500" />
                    CONFIRM PASSWORD
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={confirmResetPassword}
                      onChange={(e) => setConfirmResetPassword(e.target.value)}
                      placeholder="Confirm your new password"
                      required
                      minLength={6}
                      className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all bg-gray-50 focus:bg-white text-sm"
                    />
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                  </div>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-700 font-medium flex items-start gap-1.5">
                    <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    {error}
                  </div>
                )}

                {infoMessage && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 text-xs text-emerald-700 font-medium">
                    {infoMessage}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || isPreparingRecovery}
                  className="w-full bg-[var(--hover-600)] hover:bg-[var(--hover-700)] text-white font-bold py-3 rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-black/10 text-sm"
                >
                  {loading || isPreparingRecovery ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      {isPreparingRecovery ? 'Preparing Reset Session...' : 'Resetting Password...'}
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4" />
                      Save New Password
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    auth.logout();
                    setLoginMode('patient');
                    resetRecoveryState();
                  }}
                  className="w-full text-sm font-medium text-gray-600 hover:text-gray-900 flex items-center justify-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to patient login
                </button>
              </form>
            ) : showForgotPassword ? (
              <form onSubmit={handleForgotPasswordRequest} className="space-y-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowForgotPassword(false);
                    setError('');
                    setInfoMessage('');
                  }}
                  className="text-sm font-medium text-gray-600 hover:text-gray-900 flex items-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to patient login
                </button>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-2">
                    <Mail className="w-3 h-3 text-gray-500" />
                    PATIENT EMAIL
                  </label>
                  <div className="relative">
                    <input
                      type="email"
                      value={forgotPasswordEmail}
                      onChange={(e) => setForgotPasswordEmail(e.target.value)}
                      placeholder="Enter your registered email address"
                      required
                      className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all bg-gray-50 focus:bg-white text-sm"
                      autoFocus
                    />
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 leading-relaxed">
                  We will send a secure reset link to your email. Open the link, choose a new password, and then sign in again.
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-700 font-medium flex items-start gap-1.5">
                    <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    {error}
                  </div>
                )}

                {infoMessage && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 text-xs text-emerald-700 font-medium">
                    {infoMessage}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[var(--hover-600)] hover:bg-[var(--hover-700)] text-white font-bold py-3 rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-black/10 text-sm"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Sending Reset Email...
                    </>
                  ) : (
                    <>
                      <Mail className="w-4 h-4" />
                      Send Reset Link
                    </>
                  )}
                </button>
              </form>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-2">
                    <User className="w-3 h-3 text-gray-500" />
                    {loginMode === 'admin' ? 'USERNAME / DOCTOR EMAIL' : 'EMAIL / PHONE / USERNAME'}
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder={loginMode === 'admin' 
                        ? 'Enter username or doctor email' 
                        : 'Enter your email, phone number, or username'}
                      required
                      className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all bg-gray-50 focus:bg-white text-sm"
                      autoFocus
                    />
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-2">
                    <Lock className="w-3 h-3 text-gray-500" />
                    PASSWORD
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      required
                      className="w-full pl-9 pr-10 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all bg-gray-50 focus:bg-white text-sm"
                    />
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    VERIFICATION
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-lg p-2 bg-gray-50">
                      {captchaDigits.map((digit, index) => (
                        <span key={index} className="text-lg font-bold text-gray-700 w-6 h-6 flex items-center justify-center bg-white rounded border border-gray-200">
                          {digit}
                        </span>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={generateCaptcha}
                      className="refresh-action-button p-2 border rounded-lg"
                      title="Refresh Verification"
                    >
                      <RefreshCw size={14} className="refresh-action-icon" />
                    </button>
                  </div>
                  <div className="mt-1.5">
                    <input
                      type="text"
                      value={captchaAnswer}
                      onChange={(e) => {
                        const value = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
                        setCaptchaAnswer(value);
                      }}
                      placeholder="Enter the 4 digits shown above"
                      required
                      maxLength={4}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all bg-gray-50 focus:bg-white text-sm"
                    />
                  </div>
                </div>

                {loginMode === 'patient' && (
                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setShowForgotPassword(true);
                        setForgotPasswordEmail(username.includes('@') ? username : '');
                        setError('');
                        setInfoMessage('');
                      }}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-700 font-medium flex items-start gap-1.5">
                    <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    {error}
                  </div>
                )}

                {infoMessage && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 text-xs text-emerald-700 font-medium">
                    {infoMessage}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[var(--hover-600)] hover:bg-[var(--hover-700)] text-white font-bold py-3 rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-black/10 text-sm"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Authenticating...
                    </>
                  ) : (
                    <>
                      <Shield className="w-4 h-4" />
                      {loginMode === 'admin' ? 'Secure Sign In' : 'Patient Login'}
                    </>
                  )}
                </button>
              </form>
            )}

            {/* Patient Registration Link */}
            {loginMode === 'patient' && !showForgotPassword && !isRecoveryMode && (
              <div className="mt-4 pt-4 border-t border-gray-100 text-center">
                <p className="text-sm text-gray-600 mb-3">Don't have an account?</p>
                <button
                  onClick={() => setShowRegistration(true)}
                  className="w-full bg-white border border-indigo-200 text-indigo-600 hover:bg-indigo-50 font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <Mail className="w-4 h-4" />
                  Register New Account
                </button>
              </div>
            )}

            <div className="mt-5 pt-4 border-t border-gray-100">
              <div className="mt-3 flex items-center justify-center gap-1 text-xs text-gray-400">
                <Lock className="w-2.5 h-2.5" />
                <span>Secured by AES-256 encryption</span>
              </div>
            </div>
          </div>
          
          <div className="text-center mt-4 text-xs text-gray-500">
            <p>&copy; {new Date().getFullYear()} WinterArc Myanmar. All rights reserved.</p>
            <p className="mt-1">Version {APP_VERSION}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginView;



