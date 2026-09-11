import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { GatewayProvider, useGateway } from './services/GatewayContext';
import SetupPage from './pages/SetupPage';
import DashboardPage from './pages/DashboardPage';
import InboxPage from './pages/InboxPage';
import OutboxPage from './pages/OutboxPage';
import './App.css';

function AppRoutes() {
  const { config } = useGateway();
  const isConfigured = !!config.serverUrl && !!config.username;

  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route
        path="/dashboard"
        element={isConfigured ? <DashboardPage /> : <Navigate to="/setup" />}
      />
      <Route
        path="/inbox"
        element={isConfigured ? <InboxPage /> : <Navigate to="/setup" />}
      />
      <Route
        path="/outbox"
        element={isConfigured ? <OutboxPage /> : <Navigate to="/setup" />}
      />
      <Route path="*" element={<Navigate to={isConfigured ? '/dashboard' : '/setup'} />} />
    </Routes>
  );
}

export default function App() {
  return (
    <GatewayProvider>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </GatewayProvider>
  );
}
