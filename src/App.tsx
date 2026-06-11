import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { DataProvider } from './store/DataContext';
import { AuthProvider, useAuth } from './store/AuthContext';
import { ThemeProvider } from './store/ThemeContext';
import { MainLayout } from './components/Layout/MainLayout';
import { LandingPage } from './pages/Landing/LandingPage';
import { Login } from './pages/Auth/Login';
import { Dashboard } from './pages/Dashboard';
import { ClientsList } from './pages/Clients/ClientsList';
import { AddClient } from './pages/Clients/AddClient';
import { ClientDetail } from './pages/Clients/ClientDetail';
import { ClientRates } from './pages/Clients/ClientRates';
import { SuppliersList } from './pages/Suppliers/SuppliersList';
import { AddSupplier } from './pages/Suppliers/AddSupplier';
import { SupplierDetail } from './pages/Suppliers/SupplierDetail';
import { SupplierRates } from './pages/Suppliers/SupplierRates';
import { OTTDevices } from './pages/Suppliers/OTTDevices';
import { APIConnectors } from './pages/Suppliers/APIConnectors';
import { VoiceOTP } from './pages/Suppliers/VoiceOTP';
import { TrunksList } from './pages/Routing/TrunksList';
import { RoutesList } from './pages/Routing/RoutesList';
import { RouteMaps } from './pages/Routing/RouteMaps';
import { MCCMNCDatabase } from './pages/Rates/MCCMNCDatabase';
import { SMSLogs } from './pages/SMSLogs';
import { InvoicesList } from './pages/Billing/InvoicesList';
import { EmailTemplates } from './pages/Notifications/EmailTemplates';
import { BindStatus } from './pages/BindStatus';
import { TestSMS } from './pages/Testing/TestSMS';
import { License } from './pages/System/License';
import { TranslationsPage } from './pages/Translations';
import { CampaignsPage } from './pages/Campaigns';
import { SMSInbox } from './pages/SMSInbox';
import { UserManagement } from './pages/Users/UserManagement';
import {
  RoutePlans, RateManagement, BulkUpload, BillingOverview, PaymentsPage,
  RealtimeReport, HourlyReport, DailyReport, MonthlyReport,
  AlertsPage,
  RolesPage, PlatformSettings, DatabasePage, BackupPage,
  TestSMPPBind, TestHTTPAPI
} from './pages/RemainingPages';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" /></div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" /></div>;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public routes - redirect to dashboard if already logged in */}
      <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/landing" element={<PublicRoute><LandingPage /></PublicRoute>} />

      {/* Protected routes - redirect to login if not authenticated */}
      <Route path="/" element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="clients" element={<ClientsList />} />
        <Route path="clients/add" element={<AddClient />} />
        <Route path="clients/:id" element={<ClientDetail />} />
        <Route path="clients/:id/edit" element={<AddClient />} />
        <Route path="clients/rates" element={<ClientRates />} />
        <Route path="suppliers" element={<SuppliersList />} />
        <Route path="suppliers/add" element={<AddSupplier />} />
        <Route path="suppliers/:id" element={<SupplierDetail />} />
        <Route path="suppliers/:id/edit" element={<AddSupplier />} />
        <Route path="suppliers/rates" element={<SupplierRates />} />
        <Route path="suppliers/api-connectors" element={<APIConnectors />} />
        <Route path="suppliers/ott-devices" element={<OTTDevices />} />
        <Route path="suppliers/voice-otp" element={<VoiceOTP />} />
        <Route path="routing/trunks" element={<TrunksList />} />
        <Route path="routing/routes" element={<RoutesList />} />
        <Route path="routing/plans" element={<RoutePlans />} />
        <Route path="routing/maps" element={<RouteMaps />} />
        <Route path="rates" element={<RateManagement />} />
        <Route path="rates/upload" element={<BulkUpload />} />
        <Route path="rates/mccmnc" element={<MCCMNCDatabase />} />
        <Route path="billing" element={<BillingOverview />} />
        <Route path="billing/invoices" element={<InvoicesList />} />
        <Route path="billing/payments" element={<PaymentsPage />} />
        <Route path="sms-logs" element={<SMSLogs />} />
        <Route path="reports/realtime" element={<RealtimeReport />} />
        <Route path="reports/hourly" element={<HourlyReport />} />
        <Route path="reports/daily" element={<DailyReport />} />
        <Route path="reports/monthly" element={<MonthlyReport />} />
        <Route path="campaigns" element={<CampaignsPage />} />
          <Route path="sms-inbox" element={<SMSInbox />} />
        <Route path="bind-status" element={<BindStatus />} />
        <Route path="testing/sms" element={<TestSMS />} />
        <Route path="testing/smpp" element={<TestSMPPBind />} />
        <Route path="testing/http" element={<TestHTTPAPI />} />
        <Route path="translations" element={<TranslationsPage />} />
        <Route path="notifications/alerts" element={<AlertsPage />} />
        <Route path="notifications/templates" element={<EmailTemplates />} />
        <Route path="users" element={<UserManagement />} />
        <Route path="users/roles" element={<RolesPage />} />
        <Route path="system/settings" element={<PlatformSettings />} />
        <Route path="system/license" element={<License />} />
        <Route path="system/database" element={<DatabasePage />} />
        <Route path="system/backup" element={<BackupPage />} />
      </Route>

      {/* Catch all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <DataProvider>
            <AppRoutes />
          </DataProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
