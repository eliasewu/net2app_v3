import React, { useState, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

export const MainLayout: React.FC = () => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const closeMobile = useCallback(() => setIsMobileOpen(false), []);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        isMobileOpen={isMobileOpen}
        onCloseMobile={closeMobile}
      />
      <Header
        onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        onToggleMobile={() => setIsMobileOpen(!isMobileOpen)}
        isSidebarCollapsed={isSidebarCollapsed}
      />
      <main
        className={`pt-16 min-h-screen transition-all duration-300
          ${isSidebarCollapsed ? 'lg:ml-16' : 'lg:ml-64'}`}
      >
        <div className="p-4 lg:p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
