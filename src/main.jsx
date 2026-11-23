import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import striver180Data from './data/striver180.json';
import striverA2ZData from './data/striverA2Z.json';
import { generateSchedule, makeUniformAvailability, weeklyMinutes } from './lib/scheduler';
import { getAllPlans, savePlan, deletePlan } from './lib/firestore-db';
import { auth, googleProvider } from './lib/firebase';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut,
  onAuthStateChanged,
  updateProfile
} from 'firebase/auth';
import './style.css';

const SHEETS = {
  striver180: {
    id: 'striver180',
    name: "Striver 180",
    fullName: "Striver's 180 – Master DSA Patterns",
    shortBadge: "⚡ Striver 180",
    tag: "179 Questions",
    badgeColor: "blue",
    data: striver180Data,
    questions: striver180Data.questions,
  },
  striverA2Z: {
    id: 'striverA2Z',
    name: "Striver A-Z",
    fullName: "Striver's A-Z DSA Course",
    shortBadge: "📚 Striver A-Z",
    tag: "496 Topics",
    badgeColor: "green",
    data: striverA2ZData,
    questions: striverA2ZData.questions,
  }
};

function getSheetForPlan(plan) {
  const key = plan?.sheetType || 'striver180';
  return SHEETS[key] || SHEETS.striver180;
}

const WEEK = [
  ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'],
  ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']
];
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const fmtDate = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtHours = mins => `${Math.floor(mins / 60)}h ${mins % 60}m`;
const uid = () => crypto.randomUUID();

function createPlan(name = 'Striver 180', startDate = today(), hours = 2.2, sheetType = 'striver180') {
  return {
    id: uid(), name, sheetType, startDate, availability: makeUniformAvailability(hours), pausedDates: [],
    completedTaskIds: [], notes: {}, revisionTaskIds: [], actualMinutes: {},
    createdAt: new Date().toISOString(), scheduleVersion: 1
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TRULY STATIC SCHEDULE: Run scheduler once with ALL questions (ignoring
// completion status). Every question gets a fixed date that NEVER changes
// when you tick/untick a question. Only availability/pausedDates changes
// will re-run this.
// ─────────────────────────────────────────────────────────────────────────────
function buildStaticSchedule({ questions, startDate, availability, pausedDates = [] }) {
  const paused = new Set(pausedDates);
  const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  function dKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function addD(str, n) {
    const d = new Date(`${str}T12:00:00`);
    d.setDate(d.getDate() + n);
    return dKey(d);
  }
  function wdKey(str) {
    return DAY_KEYS[new Date(`${str}T12:00:00`).getDay()];
  }
  function cap(dateStr) {
    if (paused.has(dateStr)) return 0;
    return Math.max(0, Math.round(Number(availability?.[wdKey(dateStr)] || 0)));
  }

  const allSorted = questions.slice().sort((a, b) => a.sequence - b.sequence);
  const calendarDays = [];
  let cursor = 0;
  let date = startDate;
  let safety = 0;

  while (cursor < allSorted.length && safety < 5000) {
    safety++;
    const capacity = cap(date);
    const assigned = [];
    let used = 0;

    if (capacity > 0) {
      while (cursor < allSorted.length) {
        const q = allSorted[cursor];
        if (assigned.length > 0 && used + q.estimatedMinutes > capacity) break;
        assigned.push(q);
        used += q.estimatedMinutes;
        cursor++;
        if (used >= capacity) break;
      }
    }

    calendarDays.push({
      date,
      weekday: wdKey(date),
      capacityMinutes: capacity,
      estimatedMinutes: used,
      questions: assigned,
      isPaused: paused.has(date),
      isRestDay: capacity === 0 && !paused.has(date)
    });
    date = addD(date, 1);
  }

  // Build sprints (7-day windows)
  const sprints = [];
  for (let i = 0; i < calendarDays.length; i += 7) {
    const sprintDays = calendarDays.slice(i, i + 7);
    sprints.push({
      sprintNumber: sprints.length + 1,
      startDate: sprintDays[0]?.date,
      endDate: sprintDays[sprintDays.length - 1]?.date,
      estimatedMinutes: sprintDays.reduce((n, d) => n + d.estimatedMinutes, 0),
      questionCount: sprintDays.reduce((n, d) => n + d.questions.length, 0),
      days: sprintDays,
    });
  }

  const taskDays = calendarDays.filter(d => d.questions.length > 0);
  return {
    days: calendarDays,
    taskDays,
    sprints,
    totalEstimatedMinutes: allSorted.reduce((n, q) => n + q.estimatedMinutes, 0),
    completionDate: taskDays.at(-1)?.date ?? startDate,
    calendarDays: calendarDays.length,
  };
}

function findCurrentSprintIndex(sprints) {
  const todayStr = today();
  for (let i = 0; i < sprints.length; i++) {
    const s = sprints[i];
    if (s.startDate <= todayStr && s.endDate >= todayStr) return i;
    if (s.startDate > todayStr) return i;
  }
  return sprints.length - 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH SCREEN (CLEAN STANDARD: USERNAME/PASSWORD + GOOGLE & MOBILE OTP)
// ─────────────────────────────────────────────────────────────────────────────
function resolveEmail(identifier) {
  const clean = identifier.trim();
  if (clean.includes('@')) {
    return clean.toLowerCase();
  }
  const userSlug = clean.toLowerCase().replace(/[^a-z0-9._-]/g, '');
  return `${userSlug}@planli.app`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SAFE RECAPTCHA LIFECYCLE MANAGEMENT (PREVENTS "ALREADY RENDERED" ERRORS)
// ─────────────────────────────────────────────────────────────────────────────
function resetRecaptcha() {
  if (window.recaptchaVerifier) {
    try {
      window.recaptchaVerifier.clear();
    } catch (e) {
      console.warn('Error clearing recaptchaVerifier:', e);
    }
    window.recaptchaVerifier = null;
  }
  const container = document.getElementById('recaptcha-container');
  if (container && container.parentNode) {
    const fresh = document.createElement('div');
    fresh.id = 'recaptcha-container';
    container.parentNode.replaceChild(fresh, container);
  }
}

function getRecaptchaVerifier() {
  if (window.recaptchaVerifier) {
    return window.recaptchaVerifier;
  }
  // Ensure container DOM node is fresh
  const container = document.getElementById('recaptcha-container');
  if (container && container.parentNode) {
    const fresh = document.createElement('div');
    fresh.id = 'recaptcha-container';
    container.parentNode.replaceChild(fresh, container);
  }
  try {
    window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
      size: 'invisible',
      callback: () => {},
      'expired-callback': () => {
        resetRecaptcha();
      }
    });
  } catch (err) {
    console.warn('RecaptchaVerifier init error:', err);
    resetRecaptcha();
    window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
      size: 'invisible'
    });
  }
  return window.recaptchaVerifier;
}

function AuthScreen({ onAuth }) {
  const [view, setView] = useState('login'); // 'login' | 'register' | 'phone'
  const [name, setName] = useState('');
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Mobile phone OTP state
  const [countryCode, setCountryCode] = useState('+91');
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [confirmationResult, setConfirmationResult] = useState(null);
  const [otpSent, setOtpSent] = useState(false);

  function handleError(err) {
    if (!err) return;

    if (err.message && err.message.includes('reCAPTCHA has already been rendered')) {
      resetRecaptcha();
      setError('Verification session refreshed. Please tap Send Mobile OTP again.');
      return;
    }

    const msgs = {
      'auth/popup-closed-by-user': '',
      'auth/cancelled-popup-request': '',
      // Phone / SMS errors -> Clean, graceful user-facing fallback
      'auth/billing-not-enabled': 'Mobile OTP service is currently unavailable. Please sign in with Google or Username & Password.',
      'auth/operation-not-allowed': 'Mobile OTP service is currently unavailable. Please sign in with Google or Username & Password.',
      'auth/quota-exceeded': 'SMS service limit reached. Please sign in with Google or Username & Password.',
      'auth/too-many-requests': 'Too many attempts. Please try again later or sign in with Google / Password.',
      'auth/captcha-check-failed': 'Security verification failed. Please try again or sign in with Google.',
      'auth/invalid-phone-number': 'Please enter a valid 10-digit mobile number.',
      'auth/invalid-verification-code': 'Incorrect OTP code. Please check and try again.',
      'auth/code-expired': 'This OTP code has expired. Please request a new one.',
      // Standard credentials & domain
      'auth/unauthorized-domain': 'Google sign-in is not configured for this domain. Please sign in with Username & Password.',
      'auth/email-already-in-use': 'This username or email is already registered. Try signing in.',
      'auth/invalid-email': 'Please enter a valid username or email address.',
      'auth/weak-password': 'Password must be at least 6 characters.',
      'auth/user-not-found': 'No account found with this username/email. Create an account first.',
      'auth/wrong-password': 'Incorrect password. Please try again.',
      'auth/invalid-credential': 'Incorrect username, email, or password.',
      'auth/network-request-failed': 'Network error. Please check your internet connection.'
    };

    if (msgs[err.code] !== undefined) {
      setError(msgs[err.code]);
    } else {
      if (view === 'phone') {
        setError('Mobile OTP service is currently unavailable. Please sign in with Google or Username & Password.');
      } else {
        setError('Authentication error. Please check your credentials and try again.');
      }
    }
  }

  // 1. Username / Email + Password Login or Register
  async function handleCredentialsSubmit(e) {
    e.preventDefault();
    setError('');
    if (!usernameOrEmail.trim()) {
      setError('Please enter your username or email.');
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      return;
    }
    setLoading(true);
    try {
      const emailToUse = resolveEmail(usernameOrEmail);
      if (view === 'register') {
        if (!name.trim()) { setError('Please enter your name.'); setLoading(false); return; }
        if (password.length < 6) { setError('Password must be at least 6 characters.'); setLoading(false); return; }
        const cred = await createUserWithEmailAndPassword(auth, emailToUse, password);
        await updateProfile(cred.user, { displayName: name.trim() || usernameOrEmail.trim() });
        onAuth(cred.user);
      } else {
        const cred = await signInWithEmailAndPassword(auth, emailToUse, password);
        onAuth(cred.user);
      }
    } catch (err) {
      handleError(err);
    }
    setLoading(false);
  }

  // 2. Google Sign-In
  async function handleGoogleSignIn() {
    setError('');
    setLoading(true);
    try {
      const res = await signInWithPopup(auth, googleProvider);
      onAuth(res.user);
    } catch (err) {
      handleError(err);
    }
    setLoading(false);
  }

  // 3. Mobile Phone OTP: Send SMS
  async function handleSendPhoneOtp(e) {
    if (e && e.preventDefault) e.preventDefault();
    setError('');
    const cleanPhone = phone.trim().replace(/[^0-9]/g, '');
    if (!cleanPhone || cleanPhone.length < 10) {
      setError('Please enter a valid 10-digit mobile number.');
      return;
    }
    setLoading(true);
    try {
      const fullPhone = `${countryCode.trim()}${cleanPhone.slice(-10)}`;
      const verifier = getRecaptchaVerifier();
      const confirmation = await signInWithPhoneNumber(auth, fullPhone, verifier);
      setConfirmationResult(confirmation);
      setOtpSent(true);
    } catch (err) {
      resetRecaptcha();
      handleError(err);
    }
    setLoading(false);
  }

  // 3. Mobile Phone OTP: Verify code
  async function handleVerifyPhoneOtp(e) {
    if (e && e.preventDefault) e.preventDefault();
    setError('');
    const code = otpCode.trim();
    if (!code || code.length < 6) {
      setError('Please enter the 6-digit OTP code.');
      return;
    }
    setLoading(true);
    try {
      const res = await confirmationResult.confirm(code);
      resetRecaptcha();
      onAuth(res.user);
    } catch (err) {
      handleError(err);
    }
    setLoading(false);
  }

  return (
    <div className="auth-bg">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">P</div>
          <div>
            <b>Planli</b>
            <small>YOUR STUDY SPACE</small>
          </div>
        </div>

        {/* ── VIEW 1 & 2: SIGN IN OR CREATE ACCOUNT ──────────────────────── */}
        {(view === 'login' || view === 'register') && (
          <div>
            <div className="auth-header-block">
              <h2 className="auth-title">
                {view === 'login' ? 'Sign in to Planli' : 'Create your account'}
              </h2>
              <p className="auth-sub">
                {view === 'login'
                  ? 'Enter your username or email to continue to your roadmap.'
                  : 'Set up your personalized DSA study plan in seconds.'}
              </p>
            </div>

            <form onSubmit={handleCredentialsSubmit} className="auth-form">
              {view === 'register' && (
                <label className="auth-field">
                  <span>Your Name</span>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Akash"
                    autoComplete="name"
                    required
                  />
                </label>
              )}

              <label className="auth-field">
                <span>Username or Email</span>
                <input
                  type="text"
                  value={usernameOrEmail}
                  onChange={e => setUsernameOrEmail(e.target.value)}
                  placeholder="e.g. akash or you@email.com"
                  autoComplete="username"
                  autoFocus
                  required
                />
              </label>

              <label className="auth-field">
                <span>Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={view === 'register' ? 'Create password (min 6 chars)' : 'Your password'}
                  autoComplete={view === 'register' ? 'new-password' : 'current-password'}
                  required
                />
              </label>

              {error && <div className="auth-error">{error}</div>}

              <button type="submit" className="button primary full" disabled={loading}>
                {loading
                  ? 'Please wait…'
                  : view === 'login'
                  ? 'Sign In →'
                  : 'Create Account & Start →'}
              </button>
            </form>

            <div className="auth-switch-row">
              {view === 'login' ? (
                <p className="auth-hint">
                  Don't have an account?{' '}
                  <button
                    type="button"
                    className="auth-link"
                    onClick={() => { setView('register'); setError(''); }}
                  >
                    Create one
                  </button>
                </p>
              ) : (
                <p className="auth-hint">
                  Already have an account?{' '}
                  <button
                    type="button"
                    className="auth-link"
                    onClick={() => { setView('login'); setError(''); }}
                  >
                    Sign in
                  </button>
                </p>
              )}
            </div>

            {/* OR CONTINUE WITH (CLEAN ALTERNATIVES AT THE BOTTOM) */}
            <div className="auth-divider">
              <span>or continue with</span>
            </div>

            <div className="auth-bottom-grid">
              <button
                type="button"
                className="alt-auth-btn google-alt-btn"
                onClick={handleGoogleSignIn}
                disabled={loading}
              >
                <svg width="17" height="17" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                </svg>
                <span>Google</span>
              </button>

              <button
                type="button"
                className="alt-auth-btn phone-alt-btn"
                onClick={() => { setView('phone'); setError(''); setOtpSent(false); resetRecaptcha(); }}
                disabled={loading}
              >
                <span>📱</span>
                <span>Mobile OTP</span>
              </button>
            </div>
          </div>
        )}

        {/* ── VIEW 3: MOBILE OTP LOGIN ────────────────────────────────────── */}
        {view === 'phone' && (
          <div>
            <div className="auth-header-block">
              <h2 className="auth-title">Mobile OTP Sign In</h2>
              <p className="auth-sub">
                {!otpSent
                  ? 'We will send a 6-digit verification code to your phone.'
                  : `Enter the 6-digit code sent to ${countryCode} ${phone}`}
              </p>
            </div>

            {/* Stable invisible reCAPTCHA container that never unmounts between OTP steps */}
            <div id="recaptcha-container"></div>

            {!otpSent ? (
              <form onSubmit={handleSendPhoneOtp} className="auth-form">
                <label className="auth-field">
                  <span>Mobile Phone Number</span>
                  <div className="phone-input-row">
                    <input
                      type="text"
                      className="phone-prefix-input"
                      value={countryCode}
                      onChange={e => setCountryCode(e.target.value)}
                      placeholder="+91"
                    />
                    <input
                      type="tel"
                      className="phone-number-input"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="e.g. 9876543210"
                      autoComplete="tel"
                      autoFocus
                      required
                    />
                  </div>
                </label>

                {error && <div className="auth-error">{error}</div>}

                <button type="submit" className="button primary full" disabled={loading}>
                  {loading ? 'Sending SMS OTP…' : 'Send Mobile OTP →'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyPhoneOtp} className="auth-form">
                <label className="auth-field">
                  <span>Enter 6-Digit SMS Code</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    className="otp-code-input"
                    value={otpCode}
                    onChange={e => setOtpCode(e.target.value)}
                    placeholder="123456"
                    autoFocus
                    required
                  />
                </label>

                {error && <div className="auth-error">{error}</div>}

                <button type="submit" className="button primary full" disabled={loading}>
                  {loading ? 'Verifying OTP…' : 'Verify & Sign In →'}
                </button>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                  <button
                    type="button"
                    className="auth-link"
                    onClick={() => { setOtpSent(false); setOtpCode(''); setError(''); resetRecaptcha(); }}
                    disabled={loading}
                  >
                    ← Change number
                  </button>
                  <button
                    type="button"
                    className="auth-link resend-link"
                    onClick={handleSendPhoneOtp}
                    disabled={loading}
                  >
                    Resend OTP
                  </button>
                </div>
              </form>
            )}

            <p className="auth-hint" style={{ marginTop: 20 }}>
              <button
                type="button"
                className="auth-link"
                onClick={() => { setView('login'); setError(''); setOtpSent(false); resetRecaptcha(); }}
              >
                ← Back to username &amp; password
              </button>
            </p>
          </div>
        )}

        <p className="auth-note" style={{ marginTop: 22 }}>Your data syncs securely across all your devices.</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
function App() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = not signed in
  const [plans, setPlans] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [currentSprintIdx, setCurrentSprintIdx] = useState(0);
  const [expandedDay, setExpandedDay] = useState(today());
  const [showAdjust, setShowAdjust] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showSprintDrawer, setShowSprintDrawer] = useState(false);
  const [draftAvailability, setDraftAvailability] = useState(makeUniformAvailability(2.2));
  const [draftPauseDates, setDraftPauseDates] = useState([]);
  const [draftStartDate, setDraftStartDate] = useState(today());
  const [pauseDate, setPauseDate] = useState(today());

  // Plan creation parameters
  const [newPlanSheetType, setNewPlanSheetType] = useState('striver180');
  const [newPlanName, setNewPlanName] = useState('Striver 180');
  const [newPlanStartDate, setNewPlanStartDate] = useState(today());
  const [newPlanHours, setNewPlanHours] = useState(2.2);
  const [showNewPlan, setShowNewPlan] = useState(false);

  // Plan deletion state
  const [planToDelete, setPlanToDelete] = useState(null);

  const [noteTaskId, setNoteTaskId] = useState(null);
  const [toast, setToast] = useState('');

  // ── Auth state listener ───────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      setUser(u || null);
      if (!u) {
        setPlans([]);
        setActiveId(null);
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  // ── Load plans from Firestore when user is known ──────────────────────────
  useEffect(() => {
    if (!user) return;
    setLoading(true);
    getAllPlans(user.uid).then(saved => {
      if (!saved.length) {
        setPlans([]);
        setActiveId(null);
        setNewPlanSheetType('striver180');
        setNewPlanName('Striver 180');
        setNewPlanStartDate(today());
        setNewPlanHours(2.2);
        setShowNewPlan(true);
      } else {
        setPlans(saved);
        setActiveId(saved[0].id);
      }
    }).catch(err => {
      setToast(`Load error: ${err.message}`);
    }).finally(() => setLoading(false));
  }, [user]);

  const active = plans.find(p => p.id === activeId);

  // Active sheet & questions
  const activeSheet = useMemo(() => getSheetForPlan(active), [active]);
  const activeQuestions = activeSheet.questions;

  // STATIC schedule – depends on active sheet questions, availability/pausedDates/startDate
  const staticSchedule = useMemo(() => {
    if (!active) return null;
    return buildStaticSchedule({
      questions: activeQuestions,
      startDate: active.startDate,
      availability: active.availability,
      pausedDates: active.pausedDates || [],
    });
  }, [active?.startDate, active?.availability, active?.pausedDates, activeQuestions]);

  // For stats only – uses pending questions from the active sheet
  const pendingSchedule = useMemo(() => {
    if (!active) return null;
    return generateSchedule({
      questions: activeQuestions,
      completedTaskIds: active.completedTaskIds,
      startDate: active.startDate,
      availability: active.availability,
      pausedDates: active.pausedDates || [],
    });
  }, [active, activeQuestions]);

  useEffect(() => {
    if (staticSchedule) {
      setCurrentSprintIdx(findCurrentSprintIndex(staticSchedule.sprints));
    }
  }, [staticSchedule]);

  const originalAvailability = active?.availability || makeUniformAvailability(2.2);

  const draftSchedule = useMemo(() => {
    if (!active || !showPreview) return null;
    return buildStaticSchedule({
      questions: activeQuestions,
      startDate: draftStartDate,
      availability: draftAvailability,
      pausedDates: draftPauseDates,
    });
  }, [active, showPreview, draftAvailability, draftPauseDates, draftStartDate, activeQuestions]);

  async function persist(next) {
    await savePlan(user.uid, next);
    setPlans(prev => prev.map(p => p.id === next.id ? next : p));
  }
  function notify(message) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  }
  function openAdjust() {
    setDraftAvailability({ ...active.availability });
    setDraftPauseDates([...(active.pausedDates || [])]);
    setDraftStartDate(active.startDate > today() ? active.startDate : today());
    setShowPreview(false);
    setShowAdjust(true);
  }
  function toggleComplete(taskId) {
    const list = active.completedTaskIds.includes(taskId)
      ? active.completedTaskIds.filter(id => id !== taskId)
      : [...active.completedTaskIds, taskId];
    persist({ ...active, completedTaskIds: list });
  }
  function toggleRevision(taskId) {
    const list = active.revisionTaskIds?.includes(taskId)
      ? active.revisionTaskIds.filter(id => id !== taskId)
      : [...(active.revisionTaskIds || []), taskId];
    persist({ ...active, revisionTaskIds: list });
    notify(list.includes(taskId) ? 'Added to revision' : 'Removed from revision');
  }
  function saveNote(taskId, text) {
    const notes = { ...(active.notes || {}), [taskId]: text };
    persist({ ...active, notes });
    notify('Note saved');
  }
  async function applyAdjustment() {
    await persist({
      ...active,
      availability: draftAvailability,
      pausedDates: draftPauseDates,
      startDate: draftStartDate,
      scheduleVersion: (active.scheduleVersion || 1) + 1
    });
    setShowAdjust(false);
    setShowPreview(false);
    notify('Plan updated');
  }

  async function createNewPlan() {
    const hours = newPlanHours;
    const startDate = newPlanStartDate || today();
    const sheetType = newPlanSheetType;
    const defaultName = sheetType === 'striverA2Z' ? 'Striver A-Z' : 'Striver 180';
    const name = newPlanName.trim() || defaultName;
    const p = createPlan(name, startDate, hours, sheetType);
    await savePlan(user.uid, p);
    setPlans(prev => [...prev, p]);
    setActiveId(p.id);
    setShowNewPlan(false);
    setNewPlanSheetType('striver180');
    setNewPlanName('Striver 180');
    setNewPlanHours(2.2);
    setNewPlanStartDate(today());
    notify(`Plan "${p.name}" finalized (${SHEETS[sheetType].shortBadge} · ${(hours * 7).toFixed(1)} hrs/wk)`);
  }

  // DELETE PLAN: Confirmed deletion
  async function confirmDeletePlan() {
    if (!planToDelete) return;
    const targetId = planToDelete.id;
    const targetName = planToDelete.name;
    await deletePlan(user.uid, targetId);
    const remaining = plans.filter(p => p.id !== targetId);
    setPlans(remaining);
    setPlanToDelete(null);
    if (remaining.length > 0) {
      if (activeId === targetId) {
        setActiveId(remaining[0].id);
      }
    } else {
      setActiveId(null);
      setNewPlanSheetType('striver180');
      setNewPlanName('Striver 180');
      setNewPlanStartDate(today());
      setNewPlanHours(2.2);
      setShowNewPlan(true);
    }
    notify(`Plan "${targetName}" deleted`);
  }

  async function handleSignOut() {
    await signOut(auth);
    setUser(null);
    setPlans([]);
    setActiveId(null);
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify({ app: 'Planli', version: 1, exportedAt: new Date().toISOString(), plans }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'planli-backup.json';
    a.click();
    URL.revokeObjectURL(url);
  }
  async function importBackup(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.plans)) throw new Error('This file does not contain a Planli plans array.');
      for (const p of data.plans) {
        if (!p.id || !p.name || !p.availability || !Array.isArray(p.completedTaskIds)) throw new Error('Backup contains an invalid plan.');
        await savePlan(user.uid, p);
      }
      const reloaded = await getAllPlans(user.uid);
      setPlans(reloaded);
      if (reloaded.length) setActiveId(reloaded[0].id);
      notify(`Imported ${data.plans.length} plan(s)`);
    } catch (err) {
      notify(`Import failed: ${err.message}`);
    }
  }

  // ── Render: auth check ────────────────────────────────────────────────────
  if (user === undefined) {
    return <div className="loading-screen"><div className="brand-mark">P</div><p>Checking your session…</p></div>;
  }
  if (user === null) {
    return <AuthScreen onAuth={u => setUser(u)} />;
  }

  if (loading) return <div className="loading-screen"><div className="brand-mark">P</div><p>Preparing your study space…</p></div>;

  // New Plan Modal renderer with 2 sheet options
  const renderNewPlanModal = () => (
    <div className="modal-backdrop" onClick={() => { if (plans.length > 0) setShowNewPlan(false); }}>
      <section className="simple-modal plan-create-modal" onClick={e => e.stopPropagation()}>
        {plans.length > 0 && (
          <button className="icon-button close-simple" onClick={() => setShowNewPlan(false)}>×</button>
        )}
        <div className="eyebrow">NEW ROADMAP</div>
        <h2>{plans.length === 0 ? 'Set up your study plan' : 'Create a study plan'}</h2>
        <p>Pick your target sheet, starting date, and daily study time. We'll build your dynamic schedule.</p>

        {/* STEP 1: CHOOSE PROBLEM SHEET (2 CARDS WITH QUESTION COUNT BOX) */}
        <div className="sheet-selector-group">
          <span className="field-group-title">1. CHOOSE PROBLEM SHEET</span>
          <div className="sheet-cards-grid">
            <button
              type="button"
              className={`sheet-card ${newPlanSheetType === 'striver180' ? 'selected' : ''}`}
              onClick={() => {
                setNewPlanSheetType('striver180');
                if (!newPlanName || newPlanName === 'Striver A-Z' || newPlanName === 'My Striver A-Z Plan') {
                  setNewPlanName('Striver 180');
                }
              }}
            >
              <div className="sheet-card-top">
                <div className="sheet-radio-circle">
                  {newPlanSheetType === 'striver180' && <span className="sheet-radio-dot" />}
                </div>
                <div className="sheet-count-box badge-blue">
                  180 Questions
                </div>
              </div>
              <h3 className="sheet-card-title">Striver 180 Sheet</h3>
              <p className="sheet-card-sub">Master DSA Patterns · SDE Core Prep</p>
              <div className="sheet-card-pill-row">
                <span className="sheet-mini-tag">⏱ ~65 hrs</span>
                <span className="sheet-mini-tag">🎯 Interviews</span>
              </div>
            </button>

            <button
              type="button"
              className={`sheet-card ${newPlanSheetType === 'striverA2Z' ? 'selected' : ''}`}
              onClick={() => {
                setNewPlanSheetType('striverA2Z');
                if (!newPlanName || newPlanName === 'Striver 180' || newPlanName === 'My Striver 180 Plan') {
                  setNewPlanName('Striver A-Z');
                }
              }}
            >
              <div className="sheet-card-top">
                <div className="sheet-radio-circle">
                  {newPlanSheetType === 'striverA2Z' && <span className="sheet-radio-dot" />}
                </div>
                <div className="sheet-count-box badge-green">
                  496 Questions &amp; Topics
                </div>
              </div>
              <h3 className="sheet-card-title">Striver A-Z Sheet</h3>
              <p className="sheet-card-sub">Complete DSA Roadmap · Zero to Hero</p>
              <div className="sheet-card-pill-row">
                <span className="sheet-mini-tag">⏱ ~192 hrs</span>
                <span className="sheet-mini-tag">🚀 From Scratch</span>
              </div>
            </button>
          </div>
        </div>

        {/* STEP 2: PLAN NAME */}
        <label className="field-label">
          <span>2. PLAN NAME</span>
          <input
            value={newPlanName}
            onChange={e => setNewPlanName(e.target.value)}
            placeholder={newPlanSheetType === 'striverA2Z' ? 'e.g. Striver A-Z' : 'e.g. Striver 180'}
          />
        </label>

        {/* STEP 3: STARTING DATE */}
        <label className="field-label">
          <span>3. STARTING DATE</span>
          <input
            type="date"
            value={newPlanStartDate}
            onChange={e => setNewPlanStartDate(e.target.value)}
          />
        </label>

        {/* STEP 4: DEDICATED TIME / DAILY COMMITMENT */}
        <div className="field-label">
          <span>4. DAILY TIME DEDICATED</span>
          <div className="commitment-picker">
            <div className="stepper commitment-stepper">
              <button
                type="button"
                onClick={() => setNewPlanHours(h => Math.max(0.5, Math.round((h - 0.1) * 10) / 10))}
              >
                −
              </button>
              <b>{newPlanHours.toFixed(1)}</b>
              <small>h/day</small>
              <button
                type="button"
                onClick={() => setNewPlanHours(h => Math.min(16, Math.round((h + 0.1) * 10) / 10))}
              >
                ＋
              </button>
            </div>
            <div className="commitment-presets">
              {[1.5, 2.0, 2.2, 2.5, 3.0, 4.0].map(val => (
                <button
                  key={val}
                  type="button"
                  className={`preset-chip ${Math.abs(newPlanHours - val) < 0.05 ? 'active-chip' : ''}`}
                  onClick={() => setNewPlanHours(val)}
                >
                  {val}h
                </button>
              ))}
            </div>
          </div>
          <div className="commitment-calc">
            Weekly commitment: <b>{(newPlanHours * 7).toFixed(1)} hours</b> across 7 days ({Math.round(newPlanHours * 60)} mins/day)
          </div>
        </div>

        <button className="button primary full" onClick={createNewPlan}>
          Finalize &amp; Start {newPlanSheetType === 'striverA2Z' ? 'A-Z' : '180'} Plan →
        </button>
      </section>
    </div>
  );

  // Delete confirmation modal
  const renderDeleteConfirmModal = () => (
    planToDelete && (
      <div className="modal-backdrop" onClick={() => setPlanToDelete(null)}>
        <section className="confirm-modal" onClick={e => e.stopPropagation()}>
          <div className="confirm-header">
            <div className="confirm-icon">⚠️</div>
            <div>
              <h2>Delete "{planToDelete.name}"?</h2>
              <p>This action cannot be undone.</p>
            </div>
          </div>
          <div className="confirm-body">
            <p>
              Are you sure you want to delete this study plan? All progress,
              completed problem checkboxes, personal notes, and scheduled dates for this plan will be permanently removed.
            </p>
            <div className="confirm-notice-box">
              <span>Notice:</span> If you clicked delete accidentally, click <b>Keep Plan</b> below.
            </div>
          </div>
          <div className="confirm-footer">
            <button className="button secondary" onClick={() => setPlanToDelete(null)}>
              Keep Plan
            </button>
            <button className="button danger" onClick={confirmDeletePlan}>
              Yes, Delete Plan
            </button>
          </div>
        </section>
      </div>
    )
  );

  if (!active || !staticSchedule) {
    if (plans.length === 0) {
      return (
        <div className="loading-screen welcome-screen">
          <div className="brand-mark">P</div>
          <h2>Welcome, {user.displayName || user.email}!</h2>
          <p>Let's personalize your study schedule before we begin.</p>
          <button className="button primary" onClick={() => setShowNewPlan(true)}>
            ＋ Set up your study plan
          </button>
          {showNewPlan && renderNewPlanModal()}
          {toast && <div className="toast">{toast}</div>}
        </div>
      );
    }
    return <div className="loading-screen">Unable to load your plan. Refresh or import a backup.</div>;
  }

  const completedCount = active.completedTaskIds.length;
  const totalQuestionsCount = activeQuestions.length;
  const progress = Math.round(completedCount / totalQuestionsCount * 100);
  const remainingQuestions = totalQuestionsCount - completedCount;
  const currentWeeklyHours = weeklyMinutes(originalAvailability) / 60;
  const newWeeklyHours = weeklyMinutes(draftAvailability) / 60;

  const currentSprint = staticSchedule.sprints[currentSprintIdx] || staticSchedule.sprints[0];
  const completedSprints = staticSchedule.sprints.filter((_, i) => i < currentSprintIdx);
  const upcomingSprints = staticSchedule.sprints.filter((_, i) => i > currentSprintIdx);

  const todayStr = today();

  // Daily progress: based on today's questions in the static schedule
  const todayDay = staticSchedule.days.find(d => d.date === todayStr);
  const todayTotalTasks = todayDay?.questions.length || 0;
  const todayDoneTasks = todayDay
    ? todayDay.questions.filter(q => active.completedTaskIds.includes(q.taskId)).length
    : 0;
  const dailyProgress = todayTotalTasks > 0 ? Math.round(todayDoneTasks / todayTotalTasks * 100) : 0;
  const todayCommittedMins = todayDay?.capacityMinutes || 0;
  const todaySpentMins = todayDay
    ? todayDay.questions.filter(q => active.completedTaskIds.includes(q.taskId)).reduce((s, q) => s + q.estimatedMinutes, 0)
    : 0;

  // Filter sprint days by search
  const filteredCurrentDays = currentSprint
    ? currentSprint.days.filter(day =>
        !search || day.questions.some(q => q.title.toLowerCase().includes(search.toLowerCase())) || day.isPaused || day.isRestDay
      )
    : [];

  // For the preview modal delta
  const daysDelta = draftSchedule
    ? Math.round((new Date(`${draftSchedule.completionDate}T12:00:00`) - new Date(`${staticSchedule.completionDate}T12:00:00`)) / 86400000)
    : 0;

  // Accordion toggle: open clicked day, close if already open
  function toggleDay(date) {
    setExpandedDay(prev => prev === date ? null : date);
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">P</div><div><b>Planli</b><small>YOUR STUDY SPACE</small></div></div>
      <div className="side-heading">WORKSPACE</div>
      <button className="nav-item active"><span>▦</span> My plans</button>
      <div className="side-heading plan-heading">YOUR PLANS <span>{plans.length}</span></div>

      {/* Plan list with individual delete buttons & sheet badges */}
      <div className="plan-list">
        {plans.map(p => {
          const pSheet = getSheetForPlan(p);
          return (
            <div key={p.id} className={`plan-item-row ${p.id === activeId ? 'selected-row' : ''}`}>
              <button
                className={`plan-switch ${p.id === activeId ? 'selected' : ''}`}
                onClick={() => setActiveId(p.id)}
              >
                <span className="plan-dot" />
                <span className="plan-name-text">{p.name}</span>
                <span className={`plan-pill-tag ${p.sheetType === 'striverA2Z' ? 'pill-green' : 'pill-blue'}`}>
                  {p.sheetType === 'striverA2Z' ? 'A-Z' : '180'}
                </span>
              </button>
              <button
                className="plan-trash-btn"
                title="Delete plan"
                onClick={() => setPlanToDelete(p)}
              >
                🗑
              </button>
            </div>
          );
        })}
      </div>

      <button className="new-plan-button" onClick={() => setShowNewPlan(true)}>＋ New plan</button>

      <div className="sidebar-bottom">
        <button onClick={exportBackup}>↓ Export backup</button>
        <label className="import-button">
          ↑ Import backup
          <input type="file" accept=".json" onChange={importBackup} />
        </label>
        <button onClick={handleSignOut} className="sign-out-btn">⎋ Sign out ({user.displayName || user.email})</button>
        <p>Planli v0.2 · synced to cloud</p>
      </div>
    </aside>

    <main className="main-content">
      <div className="topbar">
        <div>
          <div className="eyebrow">
            <span className={`sheet-pill ${activeSheet.badgeColor === 'green' ? 'pill-green' : 'pill-blue'}`}>
              {activeSheet.shortBadge}
            </span>
            <span>·</span>
            SPRINT {currentSprintIdx + 1}
            <span>·</span>
            {active.name}
          </div>
          <h1>{currentSprint
            ? `${new Date(`${currentSprint.startDate}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${new Date(`${currentSprint.endDate}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
            : 'Your Study Plan'}</h1>
          <p>
            {currentSprint?.questionCount} items this sprint ·{' '}
            {fmtHours(currentSprint?.estimatedMinutes || 0)} total ·{' '}
            Finish by <b>{fmtDate(staticSchedule.completionDate)}</b>
          </p>
        </div>
        <div className="top-actions">
          <button className="button secondary" onClick={() => setShowSprintDrawer(true)}>📋 All Sprints</button>
          <button className="button secondary" onClick={openAdjust}>⚙ Adjust plan</button>
        </div>
      </div>

      {/* Stats grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <span>OVERALL PROGRESS</span>
          <strong>{progress}<small>%</small></strong>
          <div className="stat-foot">{completedCount} / {totalQuestionsCount} items done</div>
        </div>
        <div className="stat-card">
          <span>REMAINING</span>
          <strong>{remainingQuestions}<small> left</small></strong>
          <div className="stat-foot">{fmtHours(pendingSchedule?.totalEstimatedMinutes || 0)} of study time</div>
        </div>
        <div className="stat-card">
          <span>WEEKLY PACE</span>
          <strong>{currentWeeklyHours.toFixed(1)}<small>h/wk</small></strong>
          <div className="stat-foot">{Math.round(weeklyMinutes(originalAvailability) / 7)} min/day</div>
        </div>
        <div className="stat-card">
          <span>FINISH DATE</span>
          <strong className="date-stat">{fmtDate(staticSchedule.completionDate)}</strong>
          <div className="stat-foot">{staticSchedule.sprints.length} sprints total</div>
        </div>
      </div>

      {/* Progress: overall + daily */}
      <div className="progress-section">
        <div className="progress-card">
          <div className="progress-top">
            <div>
              <b>Overall Progress ({activeSheet.name})</b>
              <p>{completedCount} of {totalQuestionsCount} items completed</p>
            </div>
            <strong className={progress === 100 ? 'done-color' : ''}>{progress}%</strong>
          </div>
          <div className="progress-track">
            <i style={{ width: `${progress}%`, background: progress === 100 ? 'var(--green)' : activeSheet.badgeColor === 'green' ? 'linear-gradient(90deg,#10b981,#34d399)' : 'linear-gradient(90deg,#4b8fff,#7db1ff)' }} />
          </div>
        </div>
        <div className="progress-card daily-progress-card">
          <div className="progress-top">
            <div>
              <b>Today's Progress</b>
              <p>{todayDoneTasks} of {todayTotalTasks} tasks · {fmtHours(todaySpentMins)} / {fmtHours(todayCommittedMins)}</p>
            </div>
            <strong className={dailyProgress === 100 ? 'done-color' : ''}>{dailyProgress}%</strong>
          </div>
          <div className="progress-track">
            <i style={{ width: `${dailyProgress}%`, background: dailyProgress === 100 ? 'var(--green)' : 'linear-gradient(90deg,#27c47d,#5be3a3)' }} />
          </div>
        </div>
      </div>

      {/* Sprint area */}
      <div className="sprint-panel">
        <div className="section-toolbar">
          <div className="sprint-title-bar">
            <div>
              <div className="eyebrow">CURRENT SPRINT</div>
              <div className="sprint-meta">
                <span>{currentSprint?.questionCount} items</span>
                <span>·</span>
                <span>{fmtHours(currentSprint?.estimatedMinutes || 0)}</span>
              </div>
            </div>
            <div className="sprint-nav-actions">
              <div className="search-box">
                <span>🔍</span>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search questions & topics…"
                />
              </div>
              <div style={{ display: 'flex', gap: 7 }}>
                <button
                  className="button secondary small"
                  disabled={currentSprintIdx === 0}
                  onClick={() => setCurrentSprintIdx(i => Math.max(0, i - 1))}
                >
                  ← Prev
                </button>
                <button
                  className="button secondary small"
                  disabled={currentSprintIdx >= staticSchedule.sprints.length - 1}
                  onClick={() => setCurrentSprintIdx(i => Math.min(staticSchedule.sprints.length - 1, i + 1))}
                >
                  Next →
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="sprint-body">
          {filteredCurrentDays.map(day => {
            const isToday = day.date === todayStr;
            const isOpen = expandedDay === day.date;
            const doneCnt = day.questions.filter(q => active.completedTaskIds.includes(q.taskId)).length;
            const pct = day.questions.length > 0 ? Math.round(doneCnt / day.questions.length * 100) : 0;
            const label = new Date(`${day.date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });

            if (day.isPaused) {
              return (
                <div key={day.date} className="break-card">
                  <span>⏸ Pause day</span>
                  <span>{label}</span>
                </div>
              );
            }
            if (day.isRestDay || day.questions.length === 0) {
              return (
                <div key={day.date} className="break-card">
                  <span>🌙 Rest day</span>
                  <span>{label}</span>
                </div>
              );
            }

            return (
              <div key={day.date} className="day-accordion">
                <button
                  className={`day-accordion-btn ${isOpen ? 'day-open' : ''} ${isToday ? 'day-today' : ''}`}
                  onClick={() => toggleDay(day.date)}
                >
                  <div className="day-acc-left">
                    <div>
                      <span className="day-acc-name">{label} {isToday && <span className="today-pill">Today</span>}</span>
                      <div className="day-acc-tags">
                        <span className="day-acc-empty">{day.questions.length} items · {fmtHours(day.estimatedMinutes)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="day-acc-right">
                    <div className="day-mini-bar">
                      <div className="day-mini-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="day-acc-stat">{doneCnt}/{day.questions.length}</span>
                    <span className="day-acc-time">{fmtHours(day.estimatedMinutes)}</span>
                    <span className="day-chevron">{isOpen ? '▾' : '▸'}</span>
                  </div>
                </button>
                {isOpen && (
                  <div className="day-questions-panel">
                    {day.questions.map(q => (
                      <TaskRow
                        key={q.taskId}
                        question={q}
                        completed={active.completedTaskIds.includes(q.taskId)}
                        revision={active.revisionTaskIds?.includes(q.taskId)}
                        noteOpen={noteTaskId === q.taskId}
                        onComplete={() => toggleComplete(q.taskId)}
                        onRevision={() => toggleRevision(q.taskId)}
                        onNoteToggle={() => setNoteTaskId(prev => prev === q.taskId ? null : q.taskId)}
                        onSaveNote={note => saveNote(q.taskId, note)}
                        plan={active}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </main>

    {/* Sprint drawer (all sprints) */}
    {showSprintDrawer && (
      <div className="modal-backdrop" onClick={() => setShowSprintDrawer(false)}>
        <section className="simple-modal sprint-drawer" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <div>
              <div className="eyebrow">ALL SPRINTS · {activeSheet.name}</div>
              <h2>Your roadmap</h2>
            </div>
            <button className="icon-button" onClick={() => setShowSprintDrawer(false)}>×</button>
          </div>
          <div className="sprint-drawer-content">
            {completedSprints.length > 0 && (
              <>
                <div className="drawer-section-label">Completed</div>
                {completedSprints.map((s, i) => (
                  <SprintSummaryRow
                    key={s.sprintNumber}
                    sprint={s}
                    plan={active}
                    isCurrent={false}
                    isCompleted
                    onClick={() => { setCurrentSprintIdx(i); setShowSprintDrawer(false); }}
                  />
                ))}
              </>
            )}
            <div className="drawer-section-label current-label">Current Sprint</div>
            <SprintSummaryRow
              sprint={currentSprint}
              plan={active}
              isCurrent
              isCompleted={false}
              onClick={() => setShowSprintDrawer(false)}
            />
            {upcomingSprints.length > 0 && (
              <>
                <div className="drawer-section-label">Upcoming</div>
                {upcomingSprints.map((s, i) => (
                  <SprintSummaryRow
                    key={s.sprintNumber}
                    sprint={s}
                    plan={active}
                    isCurrent={false}
                    isCompleted={false}
                    onClick={() => { setCurrentSprintIdx(completedSprints.length + 1 + i); setShowSprintDrawer(false); }}
                  />
                ))}
              </>
            )}
          </div>
        </section>
      </div>
    )}

    {/* Adjust plan modal */}
    {showAdjust && !showPreview && (
      <div className="modal-backdrop" onClick={() => setShowAdjust(false)}>
        <section className="simple-modal adjust-modal" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <div>
              <div className="eyebrow">PLAN ADJUSTMENT · {activeSheet.name}</div>
              <h2>Update your schedule</h2>
            </div>
            <button className="icon-button" onClick={() => setShowAdjust(false)}>×</button>
          </div>
          <div className="modal-content">
            <div className="eyebrow" style={{ marginBottom: 8 }}>START DATE</div>
            <input
              type="date"
              value={draftStartDate}
              onChange={e => setDraftStartDate(e.target.value)}
              style={{ background: '#191a21', color: '#eee', border: '1px solid #363843', borderRadius: 8, padding: '10px 12px', fontSize: 12, width: '100%' }}
            />

            <div className="eyebrow" style={{ margin: '18px 0 8px' }}>DAILY AVAILABILITY (MINUTES)</div>
            {WEEK.map(([key, label]) => {
              const val = Math.round(Number(draftAvailability?.[key] || 0));
              const hrs = Math.floor(val / 60);
              const mins = val % 60;
              return (
                <div key={key} className="availability-row">
                  <span>{label}</span>
                  <div className="stepper">
                    <button type="button" onClick={() => {
                      const n = Math.max(0, val - 30);
                      setDraftAvailability(prev => ({ ...prev, [key]: n }));
                    }}>−</button>
                    <b>{hrs > 0 ? `${hrs}h ` : ''}{mins > 0 ? `${mins}m` : hrs === 0 ? '0m' : ''}</b>
                    <button type="button" onClick={() => {
                      const n = Math.min(960, val + 30);
                      setDraftAvailability(prev => ({ ...prev, [key]: n }));
                    }}>＋</button>
                  </div>
                </div>
              );
            })}

            <div className="eyebrow" style={{ margin: '18px 0 8px' }}>PAUSE DAYS</div>
            <div className="pause-editor">
              <div>
                <input
                  type="date"
                  value={pauseDate}
                  onChange={e => setPauseDate(e.target.value)}
                  style={{ background: '#191a21', color: '#eee', border: '1px solid #363843', borderRadius: 7, padding: '8px 11px', fontSize: 11 }}
                />
                <button className="button secondary small" style={{ marginLeft: 8 }} onClick={() => {
                  if (!pauseDate) return;
                  setDraftPauseDates(prev => prev.includes(pauseDate) ? prev : [...prev, pauseDate]);
                }}>Add pause</button>
              </div>
              <div className="pause-chips">
                {draftPauseDates.map(d => (
                  <span key={d} className="pause-chip">
                    {fmtDate(d)}
                    <button onClick={() => setDraftPauseDates(prev => prev.filter(x => x !== d))}>×</button>
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button className="button secondary" onClick={() => setShowAdjust(false)}>Cancel</button>
            <button className="button primary" onClick={() => setShowPreview(true)}>Preview changes →</button>
          </div>
        </section>
      </div>
    )}

    {/* Preview changes modal */}
    {showAdjust && showPreview && draftSchedule && (
      <div className="modal-backdrop" onClick={() => setShowPreview(false)}>
        <section className="simple-modal preview-modal" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <div>
              <div className="eyebrow">CHANGE PREVIEW · {activeSheet.name}</div>
              <h2>Review before confirming</h2>
            </div>
            <button className="icon-button" onClick={() => { setShowAdjust(false); setShowPreview(false); }}>×</button>
          </div>
          <div className="preview-content">
            <div className="preview-metrics">
              <div>
                <span>NEW PACE</span>
                <b>{newWeeklyHours.toFixed(1)} hrs/wk</b>
              </div>
              <div>
                <span>NEW FINISH</span>
                <b>{fmtDate(draftSchedule.completionDate)}</b>
              </div>
              <div>
                <span>TOTAL SPRINTS</span>
                <b>{draftSchedule.sprints.length}</b>
              </div>
            </div>
          </div>
          <div className="change-summary">
            <div className="change-head">
              <div>
                <span>WHAT WILL CHANGE</span>
                <b>{daysDelta < 0 ? `Your plan will finish ${Math.abs(daysDelta)} days earlier.` : daysDelta > 0 ? `Your plan will finish ${daysDelta} days later.` : 'Your estimated finish date stays the same.'}</b>
              </div>
              <span className={`delta-pill ${daysDelta <= 0 ? 'positive' : 'neutral'}`}>{daysDelta === 0 ? 'No date change' : `${daysDelta > 0 ? '+' : ''}${daysDelta} days`}</span>
            </div>
            <div className="change-details">
              <div><b>↻ {staticSchedule.sprints.length} existing sprints reviewed</b><small>Pending work is regrouped into seven-day sprints.</small></div>
              <div><b>✓ Started work is protected</b><small>Completed items and their history stay unchanged.</small></div>
            </div>
            <div className="sprint-change-list">{Array.from({ length: Math.max(staticSchedule.sprints.length, draftSchedule.sprints.length) }, (_, i) => (
              <div key={i}><span>Sprint {i+1}</span><b>{i < draftSchedule.sprints.length ? (i < staticSchedule.sprints.length ? 'Rescheduled' : 'New sprint') : 'Removed · tasks regrouped'}</b></div>
            ))}</div>
            <div className="remaining-row"><span>Remaining items</span><b>{remainingQuestions} → {remainingQuestions}</b></div>
          </div>
          <div className="modal-footer">
            <button className="button secondary" onClick={() => setShowPreview(false)}>Back</button>
            <button className="button primary" onClick={applyAdjustment}>Confirm adjustment</button>
          </div>
        </section>
      </div>
    )}

    {/* Delete confirmation modal */}
    {renderDeleteConfirmModal()}

    {/* New Plan modal */}
    {showNewPlan && renderNewPlanModal()}

    {toast && <div className="toast">{toast}</div>}
  </div>;
}

function SprintSummaryRow({ sprint, plan, isCurrent, isCompleted, onClick }) {
  const doneTasks = sprint.days.reduce((n, d) => n + d.questions.filter(q => plan.completedTaskIds.includes(q.taskId)).length, 0);
  const pct = sprint.questionCount ? Math.round(doneTasks / sprint.questionCount * 100) : 0;
  return <button className={`sprint-summary-row ${isCurrent ? 'current-sprint-row' : ''} ${isCompleted ? 'completed-sprint-row' : ''}`} onClick={onClick}>
    <div className="ssrow-left">
      <span className="ssrow-num">Sprint {sprint.sprintNumber}</span>
      <span className="ssrow-date">
        {new Date(`${sprint.startDate}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – {new Date(`${sprint.endDate}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
      </span>
    </div>
    <div className="ssrow-right">
      <span>{doneTasks}/{sprint.questionCount} done</span>
      <div className="ssrow-bar"><div className="ssrow-fill" style={{ width: `${pct}%` }}/></div>
      <span className="ssrow-pct">{pct}%</span>
      {isCurrent && <span className="ssrow-badge current-badge">Current</span>}
      {isCompleted && <span className="ssrow-badge done-badge">Done</span>}
    </div>
  </button>;
}

function TaskRow({ question, completed, revision, noteOpen, onComplete, onRevision, onNoteToggle, onSaveNote, plan }) {
  const [draft, setDraft] = useState(plan.notes?.[question.taskId] || '');
  useEffect(() => setDraft(plan.notes?.[question.taskId] || ''), [plan.notes, question.taskId]);
  const isTheory = question.contentType === 'Theory' || question.type === 'theory';
  const tufUrl = plan?.sheetType === 'striverA2Z'
    ? 'https://takeuforward.org/prep-hub/strivers-a2z-dsa-sheet'
    : (question.tufSheetUrl || 'https://takeuforward.org/prep-hub/strivers-180-master-dsa-patterns');

  return (
    <div className={`task-wrap ${completed ? 'task-complete' : ''}`}>
      <div className="task-row">
        <label className="check-wrap">
          <input type="checkbox" checked={completed} onChange={onComplete}/>
          <span className="custom-check">✓</span>
        </label>
        <div className="task-info">
          <div className="task-title-line">
            <b>{question.title}</b>
            {isTheory && <span className="theory-badge">Theory</span>}
          </div>
          <small>
            {question.estimatedMinutes} min <span>·</span> #{question.sequence}
          </small>
        </div>
        <div className="task-actions">
          <button className={revision ? 'active-icon' : ''} onClick={onRevision} title="Add to revision list">☆</button>
          <button onClick={onNoteToggle} title="Personal notes">▤</button>
          <a href={tufUrl} target="_blank" rel="noreferrer" title="Open TUF">Open TUF ↗</a>
        </div>
      </div>
      {noteOpen && (
        <div className="note-editor">
          <textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder="Write your approach, mistakes, complexity, or revision notes…"/>
          <button className="button secondary small" onClick={() => onSaveNote(draft)}>Save note</button>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App/>);
