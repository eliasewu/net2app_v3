import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

export const MainLayout: React.FC = () => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar isCollapsed={isSidebarCollapsed} />
      <Header
        onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        isSidebarCollapsed={isSidebarCollapsed}
      />
      <main
        className={`pt-16 min-h-screen transition-all duration-300
          ${isSidebarCollapsed ? 'ml-16' : 'ml-64'}`}
      >
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
