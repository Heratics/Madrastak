import React, { createContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { isTokenExpired, setupAuthInterceptor } from '../utils/auth';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const navigate = useNavigate();

  // 1. Synchronously evaluate initial auth state on startup.
  // If an expired or corrupted token is stored, purge it immediately so the user
  // never appears authenticated even for a single render cycle.
  const [user, setUser] = useState(() => {
    if (typeof localStorage === 'undefined') return null;
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');

    if (!token) return null;

    if (isTokenExpired(token)) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      return null;
    }

    if (savedUser) {
      try {
        return JSON.parse(savedUser);
      } catch (e) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        return null;
      }
    }

    return null;
  });

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      navigate('/login');
    }
  }, [navigate]);

  const login = useCallback((token, userData) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
    navigate(userData.role === 'admin' ? '/home' : '/dashboard');
  }, [navigate]);

  // 2. Setup global fetch interceptor & startup / lifecycle expiration listeners
  useEffect(() => {
    // Install global fetch interceptor to catch any 401 on protected Madrastak API requests
    setupAuthInterceptor(() => {
      logout();
    });

    // Check token on startup: if token was expired, ensure user is redirected to /login
    const initialToken = localStorage.getItem('token');
    if (initialToken && isTokenExpired(initialToken)) {
      logout();
      return;
    }

    // Handle unauthorized event dispatched by getValidToken or other helpers
    const handleUnauthorizedEvent = () => {
      logout();
    };
    window.addEventListener('madrastak:unauthorized', handleUnauthorizedEvent);

    // Periodic & focus check: verifies token if tab was left open or user returns to window
    const checkExpiration = () => {
      const currentToken = localStorage.getItem('token');
      if (currentToken && isTokenExpired(currentToken)) {
        logout();
      }
    };

    window.addEventListener('focus', checkExpiration);
    const interval = setInterval(checkExpiration, 30000); // Check every 30 seconds

    return () => {
      window.removeEventListener('madrastak:unauthorized', handleUnauthorizedEvent);
      window.removeEventListener('focus', checkExpiration);
      clearInterval(interval);
    };
  }, [logout]);

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};