import React from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import '../../css/Layout/Layout.css';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="layout">
      <Sidebar />
      <div className="layout__body">
        <Header />
        <main className="layout__main">{children}</main>
      </div>
    </div>
  );
}
