import React, { useState } from 'react';
import {
  Menu, Bell, Search, User, Settings, LogOut, ChevronDown,
  Sun, Moon, Globe
} from 'lucide-react';
import { useAuth } from '../../store/AuthContext';
import { useData } from '../../store/DataContext';

interface HeaderProps {
  onToggleSidebar: () => void;
  isSidebarCollapsed: boolean;
}

function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

export const Header: React.FC<HeaderProps> = ({ onToggleSidebar, isSidebarCollapsed }) => {
  const { notifications, smsLogs, suppliers } = useData();
  const { logout } = useAuth();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);

  const unreadNotifications = notifications.filter(n => !n.is_read);

  // Real data from database
  const today = new Date().toISOString().split('T')[0];
  const deliveredToday = smsLogs.filter(l => l.submit_time?.startsWith(today) && l.status === 'delivered').length;
  const failedToday = smsLogs.filter(l => l.submit_time?.startsWith(today) && l.status === 'failed').length;
  const totalToday = deliveredToday + failedToday;
  const deliveryRate = totalToday > 0 ? ((deliveredToday / totalToday) * 100).toFixed(1) : '100.0';
  const boundCount = suppliers.filter(s => s.bind_status === 'bound').length;
  const totalSupplierCount = suppliers.filter(s => s.status === 'active').length;

  return (
    <header className={`fixed top-0 right-0 h-16 bg-white border-b border-gray-200 z-30 transition-all duration-300
      ${isSidebarCollapsed ? 'left-16' : 'left-64'}`}>
      <div className="h-full px-4 flex items-center justify-between">
        {/* Left side */}
        <div className="flex items-center gap-4">
          <button
            onClick={onToggleSidebar}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <Menu size={20} className="text-gray-600" />
          </button>

          {/* Search */}
          <div className="relative hidden md:block">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search clients, suppliers, logs..."
              className="w-80 pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {/* Quick stats */}
          <div className="hidden lg:flex items-center gap-4 mr-4 pr-4 border-r border-gray-200">
            <div className="text-center">
              <p className="text-xs text-gray-500">Today's SMS</p>
              <p className="text-sm font-semibold text-gray-800">{formatNumber(totalToday || smsLogs.length)}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">Active Binds</p>
              <p className="text-sm font-semibold text-green-600">{boundCount}/{totalSupplierCount}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">Delivery Rate</p>
              <p className="text-sm font-semibold text-blue-600">{deliveryRate}%</p>
            </div>
          </div>

          {/* Theme toggle */}
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            {isDarkMode ? <Sun size={20} className="text-gray-600" /> : <Moon size={20} className="text-gray-600" />}
          </button>

          {/* Language */}
          <button className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <Globe size={20} className="text-gray-600" />
          </button>

          {/* Notifications */}
          <div className="relative">
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors relative"
            >
              <Bell size={20} className="text-gray-600" />
              {unreadNotifications.length > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                  {unreadNotifications.length}
                </span>
              )}
            </button>

            {showNotifications && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
                <div className="p-3 border-b border-gray-200 bg-gray-50">
                  <h3 className="font-semibold text-gray-800">Notifications</h3>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.slice(0, 5).map(notif => (
                    <div
                      key={notif.id}
                      className={`p-3 border-b border-gray-100 hover:bg-gray-50 cursor-pointer
                        ${!notif.is_read ? 'bg-blue-50' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-2 h-2 rounded-full mt-2
                          ${notif.type === 'error' ? 'bg-red-500' : 
                            notif.type === 'warning' ? 'bg-yellow-500' :
                            notif.type === 'success' ? 'bg-green-500' : 'bg-blue-500'}`}
                        />
                        <div>
                          <p className="text-sm font-medium text-gray-800">{notif.title}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{notif.message}</p>
                          <p className="text-xs text-gray-400 mt-1">
                            {new Date(notif.created_at).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-2 bg-gray-50 border-t border-gray-200">
                  <button className="w-full text-center text-sm text-blue-600 hover:text-blue-700 font-medium py-1">
                    View All Notifications
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* User menu */}
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                <User size={16} className="text-white" />
              </div>
              <div className="hidden md:block text-left">
                <p className="text-sm font-medium text-gray-800">Admin</p>
                <p className="text-xs text-gray-500">Super Admin</p>
              </div>
              <ChevronDown size={16} className="text-gray-400 hidden md:block" />
            </button>

            {showUserMenu && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
                <div className="p-3 border-b border-gray-200 bg-gray-50">
                  <p className="font-medium text-gray-800">admin@net2app.com</p>
                  <p className="text-xs text-gray-500">Super Administrator</p>
                </div>
                <div className="py-1">
                  <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                    <User size={16} />
                    <span>Profile</span>
                  </button>
                  <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                    <Settings size={16} />
                    <span>Settings</span>
                  </button>
                  <hr className="my-1" />
                  <button
                onClick={() => logout()}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
              >
                    <LogOut size={16} />
                    <span>Logout</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
