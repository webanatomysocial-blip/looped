import React from 'react';
import Sidebar from './Sidebar';
import '../../css/Layout/Layout.css';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="layout">
      <Sidebar />
      <main className="layout__main">{children}</main>
    </div>
  );
}
