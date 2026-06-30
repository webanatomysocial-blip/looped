import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import Tasks from './pages/Tasks';
import Approvals from './pages/Approvals';
import AssetLibrary from './pages/AssetLibrary';
import Reports from './pages/Reports';
import Notifications from './pages/Notifications';
import Messages from './pages/Messages';
import ApprovedFiles from './pages/ApprovedFiles';
import Settings from './pages/Settings';
import UserManagement from './pages/admin/UserManagement';
import Mail from './pages/Mail';
import ContentAutomation from './pages/ContentAutomation';
import SEO from './pages/SEO';

function PrivateRoute({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* Dashboard (not for client) */}
      <Route path="/dashboard" element={
        <PrivateRoute roles={['admin', 'manager', 'employee']}>
          <Dashboard />
        </PrivateRoute>
      } />

      {/* Projects — all roles */}
      <Route path="/projects" element={
        <PrivateRoute>
          <Projects />
        </PrivateRoute>
      } />

      {/* Tasks */}
      <Route path="/tasks" element={
        <PrivateRoute roles={['admin', 'manager', 'employee']}>
          <Tasks />
        </PrivateRoute>
      } />

      {/* Approvals — manager, admin, client */}
      <Route path="/approvals" element={
        <PrivateRoute roles={['admin', 'manager', 'employee', 'client']}>
          <Approvals />
        </PrivateRoute>
      } />

      {/* Client: approved files */}
      <Route path="/approved" element={
        <PrivateRoute roles={['client', 'admin']}>
          <ApprovedFiles />
        </PrivateRoute>
      } />

      {/* Asset library */}
      <Route path="/assets" element={
        <PrivateRoute>
          <AssetLibrary />
        </PrivateRoute>
      } />

      {/* Reports — admin + manager */}
      <Route path="/reports" element={
        <PrivateRoute roles={['admin', 'manager']}>
          <Reports />
        </PrivateRoute>
      } />

      {/* Notifications */}
      <Route path="/notifications" element={
        <PrivateRoute roles={['admin', 'manager', 'employee']}>
          <Notifications />
        </PrivateRoute>
      } />

      {/* Messages — client + admin */}
      <Route path="/messages" element={
        <PrivateRoute>
          <Messages />
        </PrivateRoute>
      } />

      {/* Settings */}
      <Route path="/settings" element={
        <PrivateRoute>
          <Settings />
        </PrivateRoute>
      } />

      {/* Mail — admin, manager, employee */}
      <Route path="/mail" element={
        <PrivateRoute roles={['admin', 'manager', 'employee']}>
          <Mail />
        </PrivateRoute>
      } />

      {/* SEO Analytics — all except no restriction (client sees own data) */}
      <Route path="/seo" element={
        <PrivateRoute roles={['admin', 'manager', 'employee', 'client']}>
          <SEO />
        </PrivateRoute>
      } />

      {/* Content Automation — admin, manager, employee */}
      <Route path="/content" element={
        <PrivateRoute roles={['admin', 'manager', 'employee']}>
          <ContentAutomation />
        </PrivateRoute>
      } />

      {/* Admin only */}
      <Route path="/admin/users" element={
        <PrivateRoute roles={['admin']}>
          <UserManagement />
        </PrivateRoute>
      } />

      {/* Default redirect */}
      <Route path="/" element={
        user?.role === 'client'
          ? <Navigate to="/projects" replace />
          : <Navigate to="/dashboard" replace />
      } />
      <Route path="*" element={
        user?.role === 'client'
          ? <Navigate to="/projects" replace />
          : <Navigate to="/dashboard" replace />
      } />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
