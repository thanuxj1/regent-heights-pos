import React, { useState } from "react";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
import LoginLayout from "../components/register/LoginLayout";
import { useAuth } from "../context/AuthContext";
import { roleHome } from "../utils/roleHome";

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, logout, user } = useAuth();
  // Every hook before any return. This page used to return early for a
  // signed-in person before its own state hooks had run.
  const [showPassword, setShowPassword] = useState(false);
  const [u_email, setEmail] = useState("");
  const [u_pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (user) {
    const home = roleHome(user.role_id);
    // Sent here by the very screen we would send them to? Sending them back
    // would bounce between the two for ever. Stop, and say so.
    const bounced = Boolean(home) && location.state?.from === home;
    if (home && !bounced) return <Navigate to={home} replace />;

    const name = [user.u_fname, user.u_lname].filter(Boolean).join(" ") || "this account";
    return (
      <LoginLayout>
        <div>
          <h2 style={{ fontSize: "22px", color: "#1a1a1a", margin: "0 0 8px" }}>You are signed in</h2>
          <p style={{ color: "#555", fontSize: 14, lineHeight: 1.6 }}>
            Signed in as <strong>{name}</strong>
            {home
              ? ", but your screen would not open."
              : ", but this account has no screen of its own here."}{" "}
            Reload the page, or sign out and sign in again.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ padding: "12px 18px", background: "linear-gradient(90deg, #0056A2 0%, #00B4EB 100%)", color: "#fff", border: "none", borderRadius: 12, fontWeight: 600, cursor: "pointer" }}
            >
              Reload
            </button>
            <button
              type="button"
              onClick={logout}
              style={{ padding: "12px 18px", background: "#fff", color: "#0056A2", border: "1px solid #CBD5E1", borderRadius: 12, fontWeight: 600, cursor: "pointer" }}
            >
              Sign out
            </button>
          </div>
        </div>
      </LoginLayout>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await login({ u_email, u_pw }); // { token, user }
      const home = roleHome(data.user?.role_id);
      // No home of its own: this page re-renders as "signed in" and says so.
      if (home) navigate(home, { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <LoginLayout>
      <div>
        <div style={badgeStyle}>
          <span style={dotStyle}></span>
          Hotel POS
        </div>

        <h2 style={{ fontSize: "26px", color: "#1a1a1a", margin: "12px 0 4px" }}>
          Login
        </h2>
        <p style={{ color: "#888", marginBottom: "28px", fontSize: "14px" }}>
          Welcome back! Please login to your account.
        </p>

        <form onSubmit={handleSubmit}>
          <div style={inputGroup}>
            <label style={labelStyle}>Email</label>
            <div style={{ position: "relative" }}>
              <Mail size={18} style={iconStyle} />
              <input
                type="text"
                value={u_email}
                onChange={(e) => setEmail(e.target.value)}
                style={inputWithIconStyle}
                placeholder="Enter your email"
                required
              />
            </div>
          </div>

          <div style={{ ...inputGroup, marginTop: "18px" }}>
            <label style={labelStyle}>Password</label>
            <div style={{ position: "relative" }}>
              <Lock size={18} style={iconStyle} />
              <input
                type={showPassword ? "text" : "password"}
                value={u_pw}
                onChange={(e) => setPw(e.target.value)}
                style={inputWithIconStyle}
                placeholder="Enter your password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={eyeButtonStyle}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && <div style={{ color: "red", marginTop: 12 }}>{error}</div>}

          <button type="submit" style={primaryBtn} disabled={loading}>
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>

        <p style={{ marginTop: 22, fontSize: 12.5, color: "#8A8A8A", textAlign: "center", lineHeight: 1.5 }}>
          Forgot your password? Ask your administrator to set a new one
          from User Management.
        </p>
      </div>
    </LoginLayout>
  );
};

const badgeStyle = { display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'linear-gradient(90deg, #0056A2 0%, #00B4EB 100%)', color: 'white', padding: '6px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '600' };
const dotStyle = { height: '8px', width: '8px', backgroundColor: '#4ade80', borderRadius: '50%' };
const inputGroup = { display: 'flex', flexDirection: 'column', gap: '8px' };
const labelStyle = { fontSize: '14px', fontWeight: '600', color: '#444' };
const inputWithIconStyle = { width: '100%', padding: '12px 12px 12px 40px', borderRadius: '10px', border: '1px solid #ddd', boxSizing: 'border-box', fontSize: '14px' };
const iconStyle = { position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#999' };
const eyeButtonStyle = { position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: '#999' };
const primaryBtn = { width: '100%', padding: '14px', background: 'linear-gradient(90deg, #0056A2 0%, #00B4EB 100%)', color: 'white', border: 'none', borderRadius: '15px', fontWeight: 'bold', fontSize: '16px', marginTop: '24px', cursor: 'pointer', letterSpacing: '0.3px' };

export default Login;
//           {error && <div style={{ color: "red", marginTop: 12 }}>{error}</div>}
// // import React, { useState } from 'react';
// // import { useNavigate } from 'react-router-dom';
// // import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
// // import LoginLayout from '../components/register/LoginLayout';

// // const Login = () => {
// //   const navigate = useNavigate();
// //   const [showPassword, setShowPassword] = useState(false);

// //   return (
// //     <LoginLayout>
// //       <div>
// //         {/* 1. Badge */}
// //         <div style={badgeStyle}>
// //           <span style={dotStyle}></span>
// //           Hotel POS
// //         </div>

// //         {/* 2. Heading */}
// //         <h2 style={{ fontSize: '26px', color: '#1a1a1a', margin: '12px 0 4px' }}>Login</h2>
// //         <p style={{ color: '#888', marginBottom: '28px', fontSize: '14px' }}>
// //           Welcome back! Please login to your account.
// //         </p>

// //         {/* 3. Form */}
// //         <form>
// //           {/* Username/Email */}
// //           <div style={inputGroup}>
// //             <label style={labelStyle}>Username or Email</label>
// //             <div style={{ position: 'relative' }}>
// //               <Mail size={18} style={iconStyle} />
// //               <input
// //                 type="text"
// //                 style={inputWithIconStyle}
// //                 placeholder="Enter your username or email"
// //               />
// //             </div>
// //           </div>

// //           {/* Password */}
// //           <div style={{ ...inputGroup, marginTop: '18px' }}>
// //             <label style={labelStyle}>Password</label>
// //             <div style={{ position: 'relative' }}>
// //               <Lock size={18} style={iconStyle} />
// //               <input
// //                 type={showPassword ? 'text' : 'password'}
// //                 style={inputWithIconStyle}
// //                 placeholder="Enter your password"
// //               />
// //               <button
// //                 type="button"
// //                 onClick={() => setShowPassword(!showPassword)}
// //                 style={eyeButtonStyle}
// //               >
// //                 {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
// //               </button>
// //             </div>
// //           </div>

// //           {/* Remember & Forgot */}
// //           <div style={rowStyle}>
// //             <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#555' }}>
// //               <input type="checkbox" /> Remember Me
// //             </label>
// //             <span style={{ color: '#0056A2', fontSize: '13px', cursor: 'pointer', fontWeight: '600' }}>Forgot Password?</span>
// //           </div>

// //           {/* Login Button */}
// //           <button type="submit" style={primaryBtn}>
// //             Login
// //           </button>
// //         </form>

// //         {/* 4. Sign Up Link */}
// //         <p style={{ marginTop: '20px', fontSize: '14px', color: '#666', textAlign: 'center' }}>
// //           New Here?{' '}
// //           <span
// //             onClick={() => navigate('/register/step-1')}
// //             style={{ color: '#0056A2', fontWeight: 'bold', cursor: 'pointer', textDecoration: 'underline' }}
// //           >
// //             Sign Up
// //           </span>
// //         </p>

// //         {/* 5. Social Icons */}
// //         <div style={socialRow}>
// //           <div style={socialCircle}>📧</div>
// //           <div style={socialCircle}>f</div>
// //           <div style={socialCircle}>💬</div>
// //         </div>
// //       </div>
// //     </LoginLayout>
// //   );
// // };

// // // Styles
// // const badgeStyle = { display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'linear-gradient(90deg, #0056A2 0%, #00B4EB 100%)', color: 'white', padding: '6px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '600' };
// // const dotStyle = { height: '8px', width: '8px', backgroundColor: '#4ade80', borderRadius: '50%' };
// // const inputGroup = { display: 'flex', flexDirection: 'column', gap: '8px' };
// // const labelStyle = { fontSize: '14px', fontWeight: '600', color: '#444' };
// // const inputWithIconStyle = { width: '100%', padding: '12px 12px 12px 40px', borderRadius: '10px', border: '1px solid #ddd', boxSizing: 'border-box', fontSize: '14px' };
// // const iconStyle = { position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#999' };
// // const eyeButtonStyle = { position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: '#999' };
// // const rowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px' };
// // const primaryBtn = { width: '100%', padding: '14px', background: 'linear-gradient(90deg, #0056A2 0%, #00B4EB 100%)', color: 'white', border: 'none', borderRadius: '15px', fontWeight: 'bold', fontSize: '16px', marginTop: '24px', cursor: 'pointer', letterSpacing: '0.3px' };
// // const socialRow = { display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '16px' };
// // const socialCircle = { width: '38px', height: '38px', backgroundColor: 'white', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0072ff', fontSize: '18px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', border: '1px solid #eee', cursor: 'pointer' };

// // export default Login;


