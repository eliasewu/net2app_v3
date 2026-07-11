import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Building2, GitBranch, DollarSign, CreditCard,
  MessageSquare, BarChart3, Megaphone, Radio, FlaskConical, Languages,
  Bell, UserCog, Settings, ChevronDown, ChevronRight, Smartphone,
  Mic, Globe, FileText, Database, Plug, Send, Clock, X, BookOpen
} from 'lucide-react';

interface MenuItem {
  label: string;
  icon: React.ReactNode;
  path?: string;
  children?: MenuItem[];
}

const menuItems: MenuItem[] = [
  { label: 'Dashboard', icon: <LayoutDashboard size={20} />, path: '/' },
  {
    label: 'Clients',
    icon: <Users size={20} />,
    children: [
      { label: 'All Clients', icon: <Users size={16} />, path: '/clients' },
      { label: 'Add Client', icon: <Users size={16} />, path: '/clients/add' },
      { label: 'Client Rates', icon: <DollarSign size={16} />, path: '/clients/rates' },
    ]
  },
  {
    label: 'Suppliers',
    icon: <Building2 size={20} />,
    children: [
      { label: 'All Suppliers', icon: <Building2 size={16} />, path: '/suppliers' },
      { label: 'Add Supplier', icon: <Building2 size={16} />, path: '/suppliers/add' },
      { label: 'Supplier Rates', icon: <DollarSign size={16} />, path: '/suppliers/rates' },
      { label: 'API Connectors', icon: <Plug size={16} />, path: '/suppliers/api-connectors' },
      { label: 'OTT Devices', icon: <Smartphone size={16} />, path: '/suppliers/ott-devices' },
      { label: 'Voice OTP', icon: <Mic size={16} />, path: '/suppliers/voice-otp' },
    ]
  },
  {
    label: 'Routing',
    icon: <GitBranch size={20} />,
    children: [
      { label: 'Trunks', icon: <GitBranch size={16} />, path: '/routing/trunks' },
      { label: 'Routes', icon: <GitBranch size={16} />, path: '/routing/routes' },
      { label: 'Route Plans', icon: <GitBranch size={16} />, path: '/routing/plans' },
    ]
  },
  {
    label: 'Rates',
    icon: <DollarSign size={20} />,
    children: [
      { label: 'Rate Management', icon: <DollarSign size={16} />, path: '/rates' },
      { label: 'Bulk Upload', icon: <FileText size={16} />, path: '/rates/upload' },
      { label: 'MCC/MNC Database', icon: <Database size={16} />, path: '/rates/mccmnc' },
    ]
  },
  {
    label: 'Billing',
    icon: <CreditCard size={20} />,
    children: [
      { label: 'Overview', icon: <CreditCard size={16} />, path: '/billing' },
      { label: 'Invoices', icon: <FileText size={16} />, path: '/billing/invoices' },
      { label: 'Payments', icon: <CreditCard size={16} />, path: '/billing/payments' },
    ]
  },
  { label: 'SMS Logs', icon: <MessageSquare size={20} />, path: '/sms-logs' },
  { label: 'SMS Inbox (MO)', icon: <MessageSquare size={20} />, path: '/sms-inbox' },
  { label: 'Channels', icon: <Send size={20} />, path: '/channels' },
  {
    label: 'Reports',
    icon: <BarChart3 size={20} />,
    children: [
      { label: 'Real-time', icon: <BarChart3 size={16} />, path: '/reports/realtime' },
      { label: 'Hourly', icon: <BarChart3 size={16} />, path: '/reports/hourly' },
      { label: 'Daily', icon: <BarChart3 size={16} />, path: '/reports/daily' },
      { label: 'Monthly', icon: <BarChart3 size={16} />, path: '/reports/monthly' },
    ]
  },
  { label: 'Campaigns', icon: <Megaphone size={20} />, path: '/campaigns' },
  { label: 'DLR Queue', icon: <Clock size={20} />, path: '/dlr-queue' },
  { label: 'Bind Status', icon: <Radio size={20} />, path: '/bind-status' },
  {
    label: 'Testing',
    icon: <FlaskConical size={20} />,
    children: [
      { label: 'Test SMS', icon: <Send size={16} />, path: '/testing/sms' },
      { label: 'Test SMPP Bind', icon: <Radio size={16} />, path: '/testing/smpp' },
      { label: 'Test HTTP API', icon: <Globe size={16} />, path: '/testing/http' },
    ]
  },
  { label: 'Translations', icon: <Languages size={20} />, path: '/translations' },
  {
    label: 'Notifications',
    icon: <Bell size={20} />,
    children: [
      { label: 'Alerts', icon: <Bell size={16} />, path: '/notifications/alerts' },
      { label: 'Email Templates', icon: <FileText size={16} />, path: '/notifications/templates' },
    ]
  },
  {
    label: 'Users',
    icon: <UserCog size={20} />,
    children: [
      { label: 'User Management', icon: <UserCog size={16} />, path: '/users' },
      { label: 'Roles & Permissions', icon: <UserCog size={16} />, path: '/users/roles' },
    ]
  },
  {
    label: 'System',
    icon: <Settings size={20} />,
    children: [
      { label: 'Platform Settings', icon: <Settings size={16} />, path: '/system/settings' },
      { label: 'License', icon: <Settings size={16} />, path: '/system/license' },
      { label: 'Database', icon: <Database size={16} />, path: '/system/database' },
      { label: 'Backup', icon: <Settings size={16} />, path: '/system/backup' },
      { label: 'API Docs', icon: <BookOpen size={16} />, path: '/system/api-docs' },
    ]
  },
];

interface SidebarProps {
  isCollapsed: boolean;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}

import { useTheme } from '../../store/ThemeContext';

export const Sidebar: React.FC<SidebarProps> = ({ isCollapsed, isMobileOpen, onCloseMobile }) => {
  const { isDark } = useTheme();
  const location = useLocation();
  const [expandedItems, setExpandedItems] = useState<string[]>(['Clients', 'Suppliers', 'Routing']);
  const touchStartX = useRef(0);
  const SWIPE_THRESHOLD = 80; // px to swipe before closing

  // Close mobile sidebar on Escape key
  useEffect(() => {
    if (!isMobileOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseMobile();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isMobileOpen, onCloseMobile]);

  // Touch swipe handlers — swipe left on the sidebar to close it
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const deltaX = touchStartX.current - e.changedTouches[0].clientX;
    // Swiped left past threshold → close the sidebar
    if (deltaX > SWIPE_THRESHOLD) {
      onCloseMobile();
    }
    touchStartX.current = 0;
  }, [onCloseMobile]);

  // Reset on touch cancel (e.g. system takeover, incoming call)
  const handleTouchCancel = useCallback(() => {
    touchStartX.current = 0;
  }, []);

  const toggleExpand = (label: string) => {
    setExpandedItems(prev =>
      prev.includes(label) ? prev.filter(item => item !== label) : [...prev, label]
    );
  };

  const isActive = (path?: string) => path && location.pathname === path;
  const hasActiveChild = (children?: MenuItem[]) =>
    children?.some(child => location.pathname === child.path);

  const renderMenuItem = (item: MenuItem, depth = 0) => {
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedItems.includes(item.label);
    const active = isActive(item.path) || hasActiveChild(item.children);

    if (hasChildren) {
      return (
        <div key={item.label}>
          <button
            onClick={() => toggleExpand(item.label)}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all duration-200
              ${active ? 'bg-blue-600 text-white font-semibold shadow-md shadow-blue-500/30' : 'text-white/90 hover:bg-white/20 hover:text-white'}
              ${isDark ? (active ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700') : ''}
              ${isCollapsed ? 'justify-center' : ''}`}
          >
            <div className="flex items-center gap-3">
              <span className={active ? 'text-white' : 'text-white/80'}>{item.icon}</span>
              {!isCollapsed && <span className="font-medium text-sm">{item.label}</span>}
            </div>
            {!isCollapsed && (
              <span className="text-gray-400">
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </span>
            )}
          </button>
          {!isCollapsed && isExpanded && (
            <div className="ml-4 mt-1 space-y-1 border-l-2 border-gray-200 pl-4">
              {item.children!.map(child => renderMenuItem(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    const handleClick = () => {
      // On mobile, close sidebar when a nav link is clicked
      onCloseMobile();
    };

    return (
      <Link
        key={item.path}
        to={item.path!}
        onClick={handleClick}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200
          ${isActive(item.path)
            ? 'bg-blue-600 text-white font-semibold shadow-md shadow-blue-500/30'
            : 'text-white/90 hover:bg-white/20 hover:text-white'}
          ${isDark ? (isActive(item.path) ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700') : ''}
          ${isCollapsed ? 'justify-center' : ''}`}
      >
        <span className={isActive(item.path) ? 'text-white' : 'text-white/80'}>{item.icon}</span>
        {!isCollapsed && <span className="font-medium text-sm">{item.label}</span>}
      </Link>
    );
  };

  const sidebarContent = (
    <aside
      className={`h-screen border-r border-blue-200/20 transition-all duration-300 z-40 overflow-hidden
        bg-gradient-to-b from-blue-700 via-blue-800 to-indigo-900
        ${isDark ? 'from-slate-800 via-slate-900 to-slate-950 border-slate-700' : 'from-blue-700 via-blue-800 to-indigo-900 border-blue-200/20'}
        ${isCollapsed ? 'w-16' : 'w-64'}`}
    >
      {/* Logo */}
      <div className="h-16 flex items-center justify-between lg:justify-center border-b border-blue-500/30 bg-gradient-to-r from-blue-600 to-indigo-600 px-3">
        {isCollapsed ? (
          <span className="text-2xl">📡</span>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-2xl">📡</span>
            <span className="text-xl font-bold text-white">NET2APP Hub</span>
          </div>
        )}
        {/* Close button — visible only on mobile */}
        <button
          onClick={onCloseMobile}
          className="lg:hidden p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Close menu"
        >
          <X size={20} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="p-3 space-y-1 h-[calc(100vh-4rem)] overflow-y-auto scrollbar-thin">
        {menuItems.map(item => renderMenuItem(item))}
      </nav>
    </aside>
  );

  return (
    <>
      {/* Mobile backdrop overlay */}
      <div
        onClick={onCloseMobile}
        role="button"
        tabIndex={-1}
        aria-label="Close sidebar"
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 lg:hidden
          ${isMobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      />

      {/* Mobile sidebar — slides in from left, swipe left to close */}
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        className={`fixed left-0 top-0 z-50 transition-transform duration-300 ease-in-out lg:hidden touch-pan-y
          ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {sidebarContent}
      </div>

      {/* Desktop sidebar — always visible, controlled by collapse */}
      <div className="hidden lg:block fixed left-0 top-0 z-40">
        {sidebarContent}
      </div>
    </>
  );
};
