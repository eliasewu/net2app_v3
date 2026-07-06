import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { Client, Supplier, Trunk, Route, RoutePlan, Rate, MCCMNC, Invoice, Payment, SMSLog, EmailTemplate, OTTDevice, APIConnector, User, DashboardStats, Notification, Campaign, Translation, VoiceOTPConfig } from '../types';
import { mockUsers, hourlyTrafficData, dailyRevenueData, topDestinations } from './mockData';
import { api, clientsApi, suppliersApi, routingApi, smsApi } from '../services/api';


interface DataContextType {
  clients: Client[]; suppliers: Supplier[]; trunks: Trunk[]; routes: Route[]; routePlans: RoutePlan[];
  rates: Rate[]; mccmnc: MCCMNC[]; invoices: Invoice[]; payments: Payment[]; smsLogs: SMSLog[];
  ottDevices: OTTDevice[]; apiConnectors: APIConnector[]; users: User[];
  emailTemplates: EmailTemplate[]; notifications: Notification[]; campaigns: Campaign[];
  translations: Translation[]; voiceOTPConfigs: VoiceOTPConfig[];
  dashboardStats: DashboardStats; hourlyTraffic: typeof hourlyTrafficData; dailyRevenue: typeof dailyRevenueData; topDest: typeof topDestinations;
  addClient:(c:Omit<Client,'id'|'created_at'|'updated_at'>)=>Promise<void>; updateClient:(id:string,c:Partial<Client>)=>Promise<void>; deleteClient:(id:string)=>Promise<void>;
  addSupplier:(s:Omit<Supplier,'id'|'created_at'|'updated_at'>)=>Promise<void>; updateSupplier:(id:string,s:Partial<Supplier>)=>Promise<void>; deleteSupplier:(id:string)=>Promise<void>;
  addSMSLog:(log:Omit<SMSLog,'id'|'created_at'|'submit_time'>)=>void;
  addTrunk:(t:Omit<Trunk,'id'|'created_at'>)=>void; updateTrunk:(id:string,t:Partial<Trunk>)=>void; deleteTrunk:(id:string)=>void;
  addRoute:(r:Omit<Route,'id'|'created_at'>)=>void; updateRoute:(id:string,r:Partial<Route>)=>void; deleteRoute:(id:string)=>void;
  addRoutePlan:(p:Omit<RoutePlan,'id'|'created_at'>)=>void; updateRoutePlan:(id:string,p:Partial<RoutePlan>)=>void; deleteRoutePlan:(id:string)=>void;
  addRate:(r:Omit<Rate,'id'>)=>void; updateRate:(id:string,r:Partial<Rate>)=>void; deleteRate:(id:string)=>void;
  addMCCMNC:(m:Omit<MCCMNC,'id'>)=>void; updateMCCMNC:(id:string,m:Partial<MCCMNC>)=>void; deleteMCCMNC:(id:string)=>void;
  addInvoice:(i:Omit<Invoice,'id'|'created_at'>)=>void; updateInvoice:(id:string,i:Partial<Invoice>)=>void;
  addPayment:(p:Omit<Payment,'id'|'created_at'>)=>void;
  addOTTDevice:(d:Omit<OTTDevice,'id'|'created_at'>)=>void; updateOTTDevice:(id:string,d:Partial<OTTDevice>)=>void; deleteOTTDevice:(id:string)=>void;
  markNotificationRead:(id:string)=>void;
  addCampaign:(c:Omit<Campaign,'id'|'created_at'>)=>void; updateCampaign:(id:string,c:Partial<Campaign>)=>void; deleteCampaign:(id:string)=>void;
  addTranslation:(t:Omit<Translation,'id'|'created_at'>)=>void; updateTranslation:(id:string,t:Partial<Translation>)=>void; deleteTranslation:(id:string)=>void;
  getClientById:(id:string)=>Client|undefined; getSupplierById:(id:string)=>Supplier|undefined; getTrunkById:(id:string)=>Trunk|undefined;
  updateEmailTemplate:(id:string,data:Partial<EmailTemplate>)=>void;
  platformSettings:Record<string,string>; updatePlatformSetting:(key:string,value:string)=>void;
  smtpConfig:any; updateSMTPConfig:(data:any)=>void;
}

const DataContext = createContext<DataContextType|undefined>(undefined);
const gid=()=>'rec_'+Date.now()+'_'+Math.random().toString(36).substr(2,9);
const nw=()=>new Date().toISOString();

export const DataProvider:React.FC<{children:ReactNode}> = ({children}) => {
  const [clients, setClients] = useState<Client[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [trunks, setTrunks] = useState<Trunk[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [routePlans, setRoutePlans] = useState<RoutePlan[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);
  const [mccmnc, setMCCMNC] = useState<MCCMNC[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [smsLogs, setSMSLogs] = useState<SMSLog[]>([]);
  const [ottDevices, setOTTDevices] = useState<OTTDevice[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [voiceOTPConfigs] = useState<VoiceOTPConfig[]>([]);
  const [platformSettings, setPlatformSettings] = useState<Record<string,string>>({platform_name:'NET2APP Hub',currency:'EUR',default_tax_rate:'19.00'});
  const [smtpConfig, setSMTPConfig] = useState<any>({host:'smtp.gmail.com',port:587,encryption:'tls'});
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);

  // ========== Fetch real data from PostgreSQL API on mount ==========
  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [clientsRes, suppliersRes, trunksRes, routesRes, plansRes, smsRes, ratesRes, mccmncRes, invoicesRes, paymentsRes, campaignsRes, translationsRes] = await Promise.all([
          clientsApi.getAll(),
          suppliersApi.getAll(),
          routingApi.getTrunks(),
          routingApi.getRoutes(),
          routingApi.getRoutePlans(),
          smsApi.getLogs({}).catch(() => ({ success: false, data: null })),
          api.get('/rates').catch(() => ({ success: false, data: null })),
          api.get('/mccmnc').catch(() => ({ success: false, data: null })),
          api.get('/invoices').catch(() => ({ success: false, data: null })),
          api.get('/payments').catch(() => ({ success: false, data: null })),
          api.get('/campaigns').catch(() => ({ success: false, data: null })),
          api.get('/translations').catch(() => ({ success: false, data: null })),
        ]);
        const cd: any = clientsRes.data;
        const sd: any = suppliersRes.data;
        const td: any = trunksRes.data;
        const rd: any = routesRes.data;
        const pd: any = plansRes.data;
        const md: any = smsRes.data;
        if (clientsRes.success && cd?.data) {
          setClients(cd.data);
        }
        if (suppliersRes.success && sd?.data) {
          setSuppliers(sd.data);
        }
        if (trunksRes.success && td?.data) {
          setTrunks(td.data);
        }
        if (routesRes.success && rd?.data) {
          setRoutes(rd.data);
        }
        if (plansRes.success && pd?.data) {
          setRoutePlans(pd.data);
        }
        if (smsRes.success && (md as any)?.data) {
          setSMSLogs((md as any).data);
        }
        const rd2: any = ratesRes.data;
        if (ratesRes.success && rd2?.data) { setRates(rd2.data); }
        const mmd: any = mccmncRes.data;
        if (mccmncRes.success && mmd?.data) { setMCCMNC(mmd.data); }
        const invd: any = invoicesRes.data;
        if (invoicesRes.success && invd?.data) { setInvoices(invd.data); }
        const payd: any = paymentsRes.data;
        if (paymentsRes.success && payd?.data) { setPayments(payd.data); }
        const campd: any = campaignsRes.data;
        if (campaignsRes.success && campd?.data) { setCampaigns(campd.data); }
        const trad: any = translationsRes.data;
        if (translationsRes.success && trad?.data) { setTranslations(trad.data); }
      } catch (e) {
        console.warn('[DataContext] API fetch failed:', e);
      }
    };
    fetchAll();
  }, []);

  // Client CRUD — call API + throw on failure for form error handling
  const addClient=useCallback(async (c:Omit<Client,'id'|'created_at'|'updated_at'>) => {
    const res = await clientsApi.create(c);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to create client');
    setClients(p => { const n = [...p, res.data.data];return n; });
  },[]);
  const updateClient=useCallback(async (id:string,c:Partial<Client>) => {
    const res = await clientsApi.update(id, c);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to update client');
    setClients(p => { const n = p.map(x => x.id === id ? res.data.data : x);return n; });
  },[]);
  const deleteClient=useCallback(async (id:string) => {
    const res = await clientsApi.delete(id);
    if (!res.success) throw new Error(res.error || 'Failed to delete client');
    setClients(p => { const n = p.filter(x => x.id !== id);return n; });
  },[]);

  // Supplier CRUD — call API + throw on failure for form error handling
  const addSupplier=useCallback(async (s:Omit<Supplier,'id'|'created_at'|'updated_at'>) => {
    const res = await suppliersApi.create(s);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to create supplier');
    setSuppliers(p => { const n = [...p, res.data.data];return n; });
  },[]);
  const updateSupplier=useCallback(async (id:string,s:Partial<Supplier>) => {
    const res = await suppliersApi.update(id, s);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to update supplier');
    setSuppliers(p => { const n = p.map(x => x.id === id ? res.data.data : x);return n; });
  },[]);
  const deleteSupplier=useCallback(async (id:string) => {
    const res = await suppliersApi.delete(id);
    if (!res.success) throw new Error(res.error || 'Failed to delete supplier');
    setSuppliers(p => { const n = p.filter(x => x.id !== id);return n; });
  },[]);

  // SMS Logs
  const addSMSLog=useCallback((log:Omit<SMSLog,'id'|'created_at'|'submit_time'>)=>{const nl:SMSLog={...log,id:gid(),submit_time:nw(),created_at:nw(),supplier_id:log.supplier_id??null,supplier_code:log.supplier_code??null,dlr_status:log.dlr_status??null,dlr_timestamp:log.dlr_timestamp??null,delivery_time:log.delivery_time??null,error_code:log.error_code??null,error_message:log.error_message??null,route_name:log.route_name??null,trunk_name:log.trunk_name??null};setSMSLogs(p=>{const n=[nl,...p];return n;});},[]);

  // Trunks, Routes, Plans
  const addTrunk=useCallback((t:Omit<Trunk,'id'|'created_at'>)=>{setTrunks(p=>{const n=[...p,{...t,id:gid(),created_at:nw()}];return n;});},[]);
  const updateTrunk=useCallback((id:string,t:Partial<Trunk>)=>{setTrunks(p=>{const n=p.map(x=>x.id===id?{...x,...t}:x);return n;});},[]);
  const deleteTrunk=useCallback((id:string)=>{setTrunks(p=>{const n=p.filter(x=>x.id!==id);return n;});},[]);
  const addRoute=useCallback((r:Omit<Route,'id'|'created_at'>)=>{setRoutes(p=>{const n=[...p,{...r,id:gid(),created_at:nw()}];return n;});},[]);
  const updateRoute=useCallback((id:string,r:Partial<Route>)=>{setRoutes(p=>{const n=p.map(x=>x.id===id?{...x,...r}:x);return n;});},[]);
  const deleteRoute=useCallback((id:string)=>{setRoutes(p=>{const n=p.filter(x=>x.id!==id);return n;});},[]);
  const addRoutePlan=useCallback((p:Omit<RoutePlan,'id'|'created_at'>)=>{setRoutePlans(prev=>{const n=[...prev,{...p,id:gid(),created_at:nw()}];return n;});},[]);
  const updateRoutePlan=useCallback((id:string,p:Partial<RoutePlan>)=>{setRoutePlans(prev=>{const n=prev.map(x=>x.id===id?{...x,...p}:x);return n;});},[]);
  const deleteRoutePlan=useCallback((id:string)=>{setRoutePlans(prev=>{const n=prev.filter(x=>x.id!==id);return n;});},[]);

  // Rates
  const addRate=useCallback((r:Omit<Rate,'id'>)=>{setRates(p=>{const n=[...p,{...r,id:gid()}];return n;});},[]);
  const updateRate=useCallback((id:string,r:Partial<Rate>)=>{setRates(p=>{const n=p.map(x=>x.id===id?{...x,...r}:x);return n;});},[]);
  const deleteRate=useCallback((id:string)=>{setRates(p=>{const n=p.filter(x=>x.id!==id);return n;});},[]);

  // MCCMNC
  const addMCCMNC=useCallback((m:Omit<MCCMNC,'id'>)=>{setMCCMNC(p=>{const n=[...p,{...m,id:gid()}];return n;});},[]);
  const updateMCCMNC=useCallback((id:string,m:Partial<MCCMNC>)=>{setMCCMNC(p=>{const n=p.map(x=>x.id===id?{...x,...m}:x);return n;});},[]);
  const deleteMCCMNC=useCallback((id:string)=>{setMCCMNC(p=>{const n=p.filter(x=>x.id!==id);return n;});},[]);

  // Invoices, Payments
  const addInvoice=useCallback(async (i:Omit<Invoice,'id'|'created_at'>) => {
    const res: any = await api.post('/invoices', i);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to create invoice');
    setInvoices(p=>{const n=[...p,res.data.data];return n;});
  },[]);
  const updateInvoice=useCallback(async (id:string,i:Partial<Invoice>) => {
    const res: any = await api.put(`/invoices/${id}`, i);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to update invoice');
    setInvoices(p=>{const n=p.map(x=>x.id===id?res.data.data:x);return n;});
  },[]);
  const addPayment=useCallback(async (p:Omit<Payment,'id'|'created_at'>) => {
    const res: any = await api.post('/payments', p);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to create payment');
    setPayments(prev=>{const n=[...prev,res.data.data];return n;});
  },[]);

  // OTT, Notifications, Campaigns, Translations
  const addOTTDevice=useCallback((d:Omit<OTTDevice,'id'|'created_at'>)=>{setOTTDevices(p=>{const n=[...p,{...d,id:gid(),created_at:nw()}];return n;});},[]);
  const updateOTTDevice=useCallback((id:string,d:Partial<OTTDevice>)=>{setOTTDevices(p=>{const n=p.map(x=>x.id===id?{...x,...d}:x);return n;});},[]);
  const deleteOTTDevice=useCallback((id:string)=>{setOTTDevices(p=>{const n=p.filter(x=>x.id!==id);return n;});},[]);
  const markNotificationRead=useCallback((id:string)=>{setNotifications(p=>{const n=p.map(x=>x.id===id?{...x,is_read:true}:x);return n;});},[]);
  const addCampaign=useCallback(async (c:Omit<Campaign,'id'|'created_at'>) => {
    const res: any = await api.post('/campaigns', c);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to create campaign');
    setCampaigns(p=>{const n=[...p,res.data.data];return n;});
  },[]);
  const updateCampaign=useCallback(async (id:string,c:Partial<Campaign>) => {
    const res: any = await api.put(`/campaigns/${id}`, c);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to update campaign');
    setCampaigns(p=>{const n=p.map(x=>x.id===id?res.data.data:x);return n;});
  },[]);
  const deleteCampaign=useCallback(async (id:string) => {
    const res: any = await api.delete(`/campaigns/${id}`);
    if (!res.success) throw new Error(res.error || 'Failed to delete campaign');
    setCampaigns(p=>{const n=p.filter(x=>x.id!==id);return n;});
  },[]);
  const addTranslation=useCallback(async (t:Omit<Translation,'id'|'created_at'>) => {
    const res: any = await api.post('/translations', t);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to create translation');
    setTranslations(p=>{const n=[...p,res.data.data];return n;});
  },[]);
  const updateTranslation=useCallback(async (id:string,t:Partial<Translation>) => {
    const res: any = await api.put(`/translations/${id}`, t);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to update translation');
    setTranslations(p=>{const n=p.map(x=>x.id===id?res.data.data:x);return n;});
  },[]);
  const deleteTranslation=useCallback(async (id:string) => {
    const res: any = await api.delete(`/translations/${id}`);
    if (!res.success) throw new Error(res.error || 'Failed to delete translation');
    setTranslations(p=>{const n=p.filter(x=>x.id!==id);return n;});
  },[]);

  // Settings
  const updatePlatformSetting=useCallback((key:string,value:string)=>{setPlatformSettings(p=>{const n={...p,[key]:value};return n;});},[]);
  const updateSMTPConfig=useCallback((data:any)=>{setSMTPConfig((prev:any)=>{const n={...prev,...data};return n;});},[]);
  const updateEmailTemplate=useCallback((id:string,data:Partial<EmailTemplate>)=>{setEmailTemplates(p=>{const n=p.map(t=>t.id===id?{...t,...data}:t);return n;});},[]);

  const getClientById=(id:string)=>clients.find(c=>c.id===id);
  const getSupplierById=(id:string)=>suppliers.find(s=>s.id===id);
  const getTrunkById=(id:string)=>trunks.find(t=>t.id===id);

  const dashboardStats: DashboardStats = {
    total_clients:clients.length,active_clients:clients.filter(c=>c.status==='active').length,
    total_suppliers:suppliers.length,active_suppliers:suppliers.filter(s=>s.status==='active').length,
    total_sms_today:smsLogs.length,total_sms_month:smsLogs.length,
    delivered_percentage:smsLogs.length>0?(smsLogs.filter(l=>l.status==='delivered').length/smsLogs.length)*100:0,
    failed_percentage:smsLogs.length>0?(smsLogs.filter(l=>l.status==='failed').length/smsLogs.length)*100:0,
    revenue_today:smsLogs.reduce((s,l)=>s+((l.client_rate||0)*(l.message_parts||1)),0),
    revenue_month:smsLogs.reduce((s,l)=>s+((l.client_rate||0)*(l.message_parts||1)),0)*30,
    cost_today:smsLogs.reduce((s,l)=>s+((l.supplier_rate||0)*(l.message_parts||1)),0),
    cost_month:smsLogs.reduce((s,l)=>s+((l.supplier_rate||0)*(l.message_parts||1)),0)*30,
    profit_today:smsLogs.reduce((s,l)=>s+(l.profit||0),0),
    profit_month:smsLogs.reduce((s,l)=>s+(l.profit||0),0)*30,
    active_binds:suppliers.filter(s=>s.bind_status==='bound').length,total_binds:suppliers.length,
  };

  return (<DataContext.Provider value={{clients,suppliers,trunks,routes,routePlans,rates,mccmnc,invoices,payments,smsLogs,ottDevices,apiConnectors:[],users:mockUsers as User[],emailTemplates,notifications,campaigns,translations,voiceOTPConfigs,dashboardStats,hourlyTraffic:hourlyTrafficData,dailyRevenue:dailyRevenueData,topDest:topDestinations,addClient,updateClient,deleteClient,addSupplier,updateSupplier,deleteSupplier,addSMSLog,addTrunk,updateTrunk,deleteTrunk,addRoute,updateRoute,deleteRoute,addRoutePlan,updateRoutePlan,deleteRoutePlan,addRate,updateRate,deleteRate,addMCCMNC,updateMCCMNC,deleteMCCMNC,addInvoice,updateInvoice,addPayment,addOTTDevice,updateOTTDevice,deleteOTTDevice,markNotificationRead,addCampaign,updateCampaign,deleteCampaign,addTranslation,updateTranslation,deleteTranslation,getClientById,getSupplierById,getTrunkById,updateEmailTemplate,platformSettings,updatePlatformSetting,smtpConfig,updateSMTPConfig}}>{children}</DataContext.Provider>);
};

export const useData = () => { const c=useContext(DataContext); if(!c) throw new Error('useData required'); return c; };
