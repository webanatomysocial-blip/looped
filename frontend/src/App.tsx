import React, { useEffect, useState } from 'react';
import { canSeeSeo, canSeeAds } from './utils/pageAccess';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';

import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import Home from './pages/Home';
import Projects from './pages/Projects';
import Tasks from './pages/Tasks';
import Approvals from './pages/Approvals';
import AssetLibrary from './pages/AssetLibrary';
import Reports from './pages/Reports';
import Notifications from './pages/Notifications';
import Messages from './pages/Messages';
import Settings from './pages/Settings';
import UserManagement from './pages/admin/UserManagement';
import ContactFormProjects from './pages/admin/ContactFormProjects';
import ContactFormProjectDetail from './pages/admin/ContactFormProjectDetail';
import ContactFormSubmissions from './pages/admin/ContactFormSubmissions';
import ContactFormEdit from './pages/admin/ContactFormEdit';
import ContactFormTest from './pages/admin/ContactFormTest';
import ContentAutomation from './pages/ContentAutomation';
import SEO from './pages/SEO';
import LocalSEO from './pages/LocalSEO';
import ShareReport from './pages/ShareReport';
import ShareAdsReport from './pages/ShareAdsReport';
import ShareTask from './pages/ShareTask';
import Ads from './pages/Ads';
import TeamCapacityPage from './pages/TeamCapacity';
import ProjectReports from './pages/ProjectReports';
import XLR8Page from './pages/XLR8Page';
import XLR8Tickets from './pages/XLR8Tickets';
import TicketTypes from './pages/admin/TicketTypes';
import LandingPage from './pages/LandingPage';
import CalendarPage from './pages/Calendar';
import RegularisationPage from './pages/Regularisation';

function PrivateRoute({ children, roles, guard }: { children: React.ReactNode; roles?: string[]; guard?: (user: any) => boolean }) {
  const { user, loading, refreshUser } = useAuth();
  const location = useLocation();
  // Path we re-checked against the server before denying (null = not checked yet)
  const [recheckedFor, setRecheckedFor] = useState<string | null>(null);
  // If user has explicit page_permissions, grant access even if role wouldn't normally allow it
  const hasExplicitPermission = user?.page_permissions?.includes(location.pathname) ?? false;
  const denied = !!user && (
    (roles && !roles.includes(user.role) && !hasExplicitPermission) ||
    (guard && !hasExplicitPermission && !guard(user))
  );
  // Access may have just been granted (new page permission or category) — fetch the
  // latest user once before bouncing to the dashboard, instead of needing a page refresh
  useEffect(() => {
    if (denied && recheckedFor !== location.pathname) {
      refreshUser().catch(() => {}).finally(() => setRecheckedFor(location.pathname));
    }
  }, [denied, location.pathname, recheckedFor]);
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (denied) {
    if (recheckedFor !== location.pathname) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading...</div>;
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />

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


      {/* Asset library */}
      <Route path="/assets" element={
        <PrivateRoute>
          <AssetLibrary />
        </PrivateRoute>
      } />

      {/* Reports — admin only */}
      <Route path="/reports" element={
        <PrivateRoute roles={['admin']}>
          <Reports />
        </PrivateRoute>
      } />

      {/* Project Reports — admin only */}
      <Route path="/project-reports" element={
        <PrivateRoute roles={['admin']}>
          <ProjectReports />
        </PrivateRoute>
      } />

      {/* XLR8 Bucket — admin only */}
      <Route path="/xlr8" element={
        <PrivateRoute roles={['admin']}>
          <XLR8Page />
        </PrivateRoute>
      } />

      {/* XLR8 Tickets — all internal roles */}
      <Route path="/xlr8-tickets" element={
        <PrivateRoute roles={['admin', 'manager', 'employee', 'client']}>
          <XLR8Tickets />
        </PrivateRoute>
      } />

      {/* Admin: Ticket Types */}
      <Route path="/admin/ticket-types" element={
        <PrivateRoute roles={['admin']}>
          <TicketTypes />
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


      {/* SEO Analytics — admin, manager, and SEO-category employees only */}
      <Route path="/seo" element={
        <PrivateRoute
          roles={['admin', 'manager', 'employee']}
          guard={canSeeSeo}
        >
          <SEO />
        </PrivateRoute>
      } />

      <Route path="/local-seo" element={
        <PrivateRoute roles={['admin', 'manager']}>
          <LocalSEO />
        </PrivateRoute>
      } />

      {/* Ads Analytics — admin, manager, and Ads-category employees only */}
      <Route path="/ads" element={
        <PrivateRoute
          roles={['admin', 'manager', 'employee']}
          guard={canSeeAds}
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

      {/* Calendar — all except client */}
      <Route path="/calendar" element={
        <PrivateRoute roles={['admin', 'manager', 'employee']}>
          <CalendarPage />
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

      {/* Contact Forms — admin only */}
      <Route path="/contact-forms" element={
        <PrivateRoute roles={['admin', 'manager', 'employee']}>
          <ContactFormProjects />
        </PrivateRoute>
      } />
      <Route path="/contact-forms/:id" element={
        <PrivateRoute roles={['admin', 'manager', 'employee']}>
          <ContactFormProjectDetail />
        </PrivateRoute>
      } />
      <Route path="/contact-forms/:id/submissions" element={
        <PrivateRoute roles={['admin', 'manager', 'employee']}>
          <ContactFormSubmissions />
        </PrivateRoute>
      } />
      <Route path="/contact-forms/:id/forms/:formId" element={
        <PrivateRoute roles={['admin', 'manager', 'employee']}>
          <ContactFormEdit />
        </PrivateRoute>
      } />
      <Route path="/contact-forms/:id/forms/:formId/test" element={
        <PrivateRoute roles={['admin', 'manager', 'employee']}>
          <ContactFormTest />
        </PrivateRoute>
      } />

      {/* Default redirect */}
      <Route path="/share/:token" element={<ShareReport />} />
      <Route path="/share/ads/:token" element={<ShareAdsReport />} />
      <Route path="/share/task/:token" element={<ShareTask />} />
      <Route path="/" element={
        user
          ? (user.role === 'client' ? <Navigate to="/projects" replace /> : <Navigate to="/dashboard" replace />)
          : <LandingPage />
      } />
      <Route path="*" element={
        user?.role === 'client'
          ? <Navigate to="/projects" replace />
          : <Navigate to="/dashboard" replace />
      } />
      <Route path="/regularisation" element={
        <PrivateRoute roles={['admin', 'manager']}><RegularisationPage /></PrivateRoute>
      } />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <SocketProvider>
          <AppRoutes />
        </SocketProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
