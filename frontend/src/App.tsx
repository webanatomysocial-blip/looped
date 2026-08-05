import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';

import Login from './pages/Login';
import Home from './pages/Home';
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
import ShareReport from './pages/ShareReport';
import Ads from './pages/Ads';
import TeamCapacityPage from './pages/TeamCapacity';
import ProjectReports from './pages/ProjectReports';

function PrivateRoute({ children, roles, guard }: { children: React.ReactNode; roles?: string[]; guard?: (user: any) => boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  if (guard && !guard(user)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* Dashboard */}
      <Route path="/dashboard" element={
        <PrivateRoute>
          <Home />
        </PrivateRoute>
      } />

      {/* /home redirects to /dashboard */}
      <Route path="/home" element={<Navigate to="/dashboard" replace />} />

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

      {/* All roles: approved files */}
      <Route path="/approved" element={
        <PrivateRoute>
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

      {/* Project Reports — admin + manager */}
      <Route path="/project-reports" element={
        <PrivateRoute roles={['admin', 'manager']}>
          <ProjectReports />
        </PrivateRoute>
      } />

      {/* Notifications */}
      <Route path="/notifications" element={
        <PrivateRoute>
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

      {/* SEO Analytics — admin, manager, and SEO-category employees only */}
      <Route path="/seo" element={
        <PrivateRoute
          roles={['admin', 'manager', 'employee']}
          guard={(u) => u.role !== 'employee' || (u.categories?.some((c: any) => /seo/i.test(c.name)) ?? false)}
        >
          <SEO />
        </PrivateRoute>
      } />

      {/* Ads Analytics — admin, manager, and Ads-category employees only */}
      <Route path="/ads" element={
        <PrivateRoute
          roles={['admin', 'manager', 'employee']}
          guard={(u) => u.role !== 'employee' || (u.categories?.some((c: any) => /ads/i.test(c.name)) ?? false)}
        >
          <Ads />
        </PrivateRoute>
      } />

      {/* Content Automation — admin, manager, employee */}
      <Route path="/content" element={
        <PrivateRoute roles={['admin', 'manager', 'employee']}>
          <ContentAutomation />
        </PrivateRoute>
      } />

      {/* Team Capacity — admin + manager */}
      <Route path="/team-capacity" element={
        <PrivateRoute roles={['admin', 'manager']}>
          <TeamCapacityPage />
        </PrivateRoute>
      } />

      {/* Admin only */}
      <Route path="/admin/users" element={
        <PrivateRoute roles={['admin']}>
          <UserManagement />
        </PrivateRoute>
      } />

      {/* Default redirect */}
      <Route path="/share/:token" element={<ShareReport />} />
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
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
