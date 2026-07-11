import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { Client, Supplier, Trunk, Route, RoutePlan, Rate, MCCMNC, Invoice, Payment, SMSLog, EmailTemplate, OTTDevice, APIConnector, User, DashboardStats, Notification, Campaign, Translation, VoiceOTPConfig, DLRQueue, SMTPConfig } from '../types';
import { hourlyTrafficData, dailyRevenueData, topDestinations } from './mockData';
import { api, clientsApi, suppliersApi, routingApi, smsApi } from '../services/api';
import { useAuth } from './AuthContext';


interface DataContextType {
  clients: Client[]; suppliers: Supplier[]; trunks: Trunk[]; routes: Route[]; routePlans: RoutePlan[];
  rates: Rate[]; mccmnc: MCCMNC[]; invoices: Invoice[]; payments: Payment[]; smsLogs: SMSLog[];
  ottDevices: OTTDevice[]; apiConnectors: APIConnector[]; users: User[];
  emailTemplates: EmailTemplate[]; notifications: Notification[]; campaigns: Campaign[];
  translations: Translation[]; voiceOTPConfigs: VoiceOTPConfig[];
  dashboardStats: DashboardStats; hourlyTraffic: typeof hourlyTrafficData; dailyRevenue: typeof dailyRevenueData; topDest: typeof topDestinations;
  addClient:(c:Omit<Client,'id'|'created_at'|'updated_at'>)=>Promise<void>; updateClient:(id:string,c:Partial<Client>)=>Promise<void>; deleteClient:(id:string)=>Promise<void>; restoreClient:(id:string)=>Promise<void>;
  addSupplier:(s:Omit<Supplier,'id'|'created_at'|'updated_at'>)=>Promise<void>; updateSupplier:(id:string,s:Partial<Supplier>)=>Promise<void>; deleteSupplier:(id:string)=>Promise<void>; restoreSupplier:(id:string)=>Promise<void>;
  addSMSLog:(log:Omit<SMSLog,'id'|'created_at'|'submit_time'>)=>void;
  addTrunk:(t:Omit<Trunk,'id'|'created_at'>)=>Promise<void>; updateTrunk:(id:string,t:Partial<Trunk>)=>Promise<void>; deleteTrunk:(id:string)=>Promise<void>;
  addRoute:(r:Omit<Route,'id'|'created_at'>)=>Promise<void>; updateRoute:(id:string,r:Partial<Route>)=>Promise<void>; deleteRoute:(id:string)=>Promise<void>;
  addRoutePlan:(p:Omit<RoutePlan,'id'|'created_at'>)=>Promise<void>; updateRoutePlan:(id:string,p:Partial<RoutePlan>)=>Promise<void>; deleteRoutePlan:(id:string)=>Promise<void>;
  addRate:(r:Omit<Rate,'id'>)=>Promise<void>; updateRate:(id:string,r:Partial<Rate>)=>Promise<void>; deleteRate:(id:string)=>Promise<void>;
  addMCCMNC:(m:Omit<MCCMNC,'id'>)=>Promise<void>; updateMCCMNC:(id:string,m:Partial<MCCMNC>)=>Promise<void>; deleteMCCMNC:(id:string)=>Promise<void>;
  mccmncTotal: number; fetchMCCMNC:(params?:{search?:string;country?:string;offset?:number;limit?:number})=>Promise<void>;
  addInvoice:(i:Omit<Invoice,'id'|'created_at'>)=>Promise<void>; updateInvoice:(id:string,i:Partial<Invoice>)=>Promise<void>;
  addPayment:(p:Omit<Payment,'id'|'created_at'>)=>Promise<void>;
  addOTTDevice:(d:Omit<OTTDevice,'id'|'created_at'>)=>Promise<void>; updateOTTDevice:(id:string,d:Partial<OTTDevice>)=>Promise<void>; deleteOTTDevice:(id:string)=>Promise<void>;
  addApiConnector:(c:Omit<APIConnector,'id'|'created_at'>)=>Promise<void>; updateApiConnector:(id:string,c:Partial<APIConnector>)=>Promise<void>; deleteApiConnector:(id:string)=>Promise<void>;
  markNotificationRead:(id:string)=>Promise<void>;
  addCampaign:(c:Omit<Campaign,'id'|'created_at'>)=>Promise<void>; updateCampaign:(id:string,c:Partial<Campaign>)=>Promise<void>; deleteCampaign:(id:string)=>Promise<void>;
  addTranslation:(t:Omit<Translation,'id'|'created_at'>)=>Promise<void>; updateTranslation:(id:string,t:Partial<Translation>)=>Promise<void>; deleteTranslation:(id:string)=>Promise<void>;
  getClientById:(id:string)=>Client|undefined; getSupplierById:(id:string)=>Supplier|undefined; getTrunkById:(id:string)=>Trunk|undefined;
  updateEmailTemplate:(id:string,data:Partial<EmailTemplate>)=>Promise<void>;
  platformSettings:Record<string,string>; updatePlatformSetting:(key:string,value:string)=>Promise<void>;
  smtpConfig:SMTPConfig; updateSMTPConfig:(data:Partial<SMTPConfig>)=>Promise<void>;
  smsTotal: number; fetchSMSLogs:(filters?:any & {offset?:number;limit?:number})=>Promise<void>;
  dlrQueue: DLRQueue[];
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
  const [mccmncTotal, setMCCMNCTotal] = useState(0);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [smsLogs, setSMSLogs] = useState<SMSLog[]>([]);
  const [smsTotal, setSMSTotal] = useState(0);
  const [ottDevices, setOTTDevices] = useState<OTTDevice[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [voiceOTPConfigs, setVoiceOTPConfigs] = useState<VoiceOTPConfig[]>([]);
  const [platformSettings, setPlatformSettings] = useState<Record<string,string>>({platform_name:'NET2APP Hub',currency:'EUR',default_tax_rate:'19.00'});
  const [smtpConfig, setSMTPConfig] = useState<SMTPConfig>({id:'',host:'smtp.gmail.com',port:587,encryption:'tls',username:'',password:'',from_email:'',from_name:'',is_active:true});
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [apiConnectors, setApiConnectors] = useState<APIConnector[]>([]);
  const [dlrQueue, setDLRQueue] = useState<DLRQueue[]>([]);

  // Watch auth state — fetch data only when authenticated (re-fetches after login)
  const { isAuthenticated } = useAuth();

  // ========== Fetch real data from PostgreSQL API ==========
  const fetchAll = useCallback(async () => {
    try {
      const [clientsRes, suppliersRes, trunksRes, routesRes, plansRes, smsRes, ratesRes, mccmncRes, invoicesRes, paymentsRes, campaignsRes, translationsRes, usersRes, connectorsRes, voiceOtpRes, ottRes, notifRes, templatesRes, settingsRes, smtpRes, dlrRes] = await Promise.all([
        clientsApi.getAll(),
        suppliersApi.getAll(),
        routingApi.getTrunks(),
        routingApi.getRoutes(),
        routingApi.getRoutePlans(),
        smsApi.getLogs({ limit: 100 }).catch(() => ({ success: false, data: null })),
        api.get('/rates').catch(() => ({ success: false, data: null })),
        api.get('/mccmnc?limit=500').catch(() => ({ success: false, data: null })),
        api.get('/invoices').catch(() => ({ success: false, data: null })),
        api.get('/payments').catch(() => ({ success: false, data: null })),
        api.get('/campaigns').catch(() => ({ success: false, data: null })),
        api.get('/translations').catch(() => ({ success: false, data: null })),
        api.get('/users').catch(() => ({ success: false, data: null })),
        api.get('/api-connectors').catch(() => ({ success: false, data: null })),
        api.get('/voice-otp/configs').catch(() => ({ success: false, data: null })),
        api.get('/ott-devices').catch(() => ({ success: false, data: null })),
        api.get('/notifications').catch(() => ({ success: false, data: null })),
        api.get('/notification-templates').catch(() => ({ success: false, data: null })),
        api.get('/platform-settings').catch(() => ({ success: false, data: null })),
        api.get('/smtp-config').catch(() => ({ success: false, data: null })),
        api.get('/dlr-queue').catch(() => ({ success: false, data: null })),
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
        if (smsRes.success && (md as any)?.data) {
          setSMSLogs((md as any).data);
          if (typeof (md as any).total === 'number') setSMSTotal((md as any).total);
        }
        }
        const rd2: any = ratesRes.data;
        if (ratesRes.success && rd2?.data) { setRates(rd2.data); }
        const mmd: any = mccmncRes.data;
        if (mccmncRes.success && mmd?.data) {
          setMCCMNC(mmd.data);
          if (typeof mmd.total === 'number') setMCCMNCTotal(mmd.total);
          else setMCCMNCTotal(Array.isArray(mmd.data) ? mmd.data.length : 0);
        }
        const invd: any = invoicesRes.data;
        if (invoicesRes.success && invd?.data) { setInvoices(invd.data); }
        const payd: any = paymentsRes.data;
        if (paymentsRes.success && payd?.data) { setPayments(payd.data); }
        const campd: any = campaignsRes.data;
        if (campaignsRes.success && campd?.data) { setCampaigns(campd.data); }
        const trad: any = translationsRes.data;
        if (translationsRes.success && trad?.data) { setTranslations(trad.data); }
        const ud: any = usersRes.data;
        if (usersRes.success && ud?.data) { setUsers(ud.data); }
        const acd: any = connectorsRes.data;
        if (connectorsRes.success && acd?.data) { setApiConnectors(acd.data); }
        const vocd: any = voiceOtpRes.data;
        if (voiceOtpRes.success && vocd?.data) {
          const arr = Array.isArray(vocd.data) ? vocd.data : [];
          setVoiceOTPConfigs(arr);
        }
        const otd: any = ottRes.data;
        if (ottRes.success && otd?.data) { setOTTDevices(otd.data); }
        const notd: any = notifRes.data;
        if (notifRes.success && notd?.data) { setNotifications(notd.data); }
        const tmd: any = templatesRes.data;
        if (templatesRes.success && tmd?.data) {
          const arr = Array.isArray(tmd.data) ? tmd.data : [];
          setEmailTemplates(arr);
        }
        const srd: any = settingsRes.data;
        if (settingsRes.success && srd?.data) {
          setPlatformSettings(srd.data as Record<string,string>);
        }
        const smtpd: any = smtpRes.data;
        if (smtpRes.success && smtpd?.data) { setSMTPConfig(smtpd.data); }
        const dlrd: any = dlrRes.data;
        if (dlrRes.success && dlrd?.data) {
          const arr = Array.isArray(dlrd.data) ? dlrd.data : [];
          setDLRQueue(arr);
        }
    } catch (e) {
        console.warn('[DataContext] API fetch failed:', e);
      }
  }, []);

  // Fetch data when authenticated (triggers on login / page refresh with cookie)
  useEffect(() => {
    if (isAuthenticated) {
      fetchAll();
    }
  }, [isAuthenticated, fetchAll]);

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
    setClients(p => { const n = p.map(x => x.id === id ? {...x, is_deleted: true, status: 'inactive' as const} : x);return n; });
  },[]);
  const restoreClient=useCallback(async (id:string) => {
    const res = await clientsApi.restore(id);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to restore client');
    setClients(p => { const n = p.map(x => x.id === id ? (res.data?.data ?? x) : x);return n; });
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
    setSuppliers(p => { const n = p.map(x => x.id === id ? {...x, is_deleted: true, status: 'inactive' as const} : x);return n; });
  },[]);
  const restoreSupplier=useCallback(async (id:string) => {
    const res = await suppliersApi.restore(id);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to restore supplier');
    setSuppliers(p => { const n = p.map(x => x.id === id ? (res.data?.data ?? x) : x);return n; });
  },[]);

  // SMS Logs — server-side paginated fetch
  const fetchSMSLogs=useCallback(async (filters?:any & {offset?:number;limit?:number}) => {
    const res: any = await smsApi.getLogs(filters || {});
    if (res.success && res.data?.data) {
      setSMSLogs(res.data.data);
      if (typeof res.data.total === 'number') setSMSTotal(res.data.total);
    }
  },[]);

  // SMS Logs
  const addSMSLog=useCallback((log:Omit<SMSLog,'id'|'created_at'|'submit_time'>)=>{const nl:SMSLog={...log,id:gid(),submit_time:nw(),created_at:nw(),supplier_id:log.supplier_id??null,supplier_code:log.supplier_code??null,dlr_status:log.dlr_status??null,dlr_timestamp:log.dlr_timestamp??null,delivery_time:log.delivery_time??null,error_code:log.error_code??null,error_message:log.error_message??null,route_name:log.route_name??null,trunk_name:log.trunk_name??null};setSMSLogs(p=>{const n=[nl,...p];return n;});},[]);

  // Trunks, Routes, Plans — API-wired
  const addTrunk=useCallback(async (t:Omit<Trunk,'id'|'created_at'>) => {
    const res: any = await api.post('/trunks', t);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to create trunk');
    setTrunks(p=>{const n=[...p,res.data.data];return n;});
  },[]);
  const updateTrunk=useCallback(async (id:string,t:Partial<Trunk>) => {
    const res: any = await api.put(`/trunks/${id}`, t);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to update trunk');
    setTrunks(p=>{const n=p.map(x=>x.id===id?res.data.data:x);return n;});
  },[]);
  const deleteTrunk=useCallback(async (id:string) => {
    const res: any = await api.delete(`/trunks/${id}`);
    if (!res.success) throw new Error(res.error || 'Failed to delete trunk');
    setTrunks(p=>{const n=p.filter(x=>x.id!==id);return n;});
  },[]);
  const addRoute=useCallback(async (r:Omit<Route,'id'|'created_at'>) => {
    const res: any = await api.post('/routes', r);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to create route');
    setRoutes(p=>{const n=[...p,res.data.data];return n;});
  },[]);
  const updateRoute=useCallback(async (id:string,r:Partial<Route>) => {
    const res: any = await api.put(`/routes/${id}`, r);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to update route');
    setRoutes(p=>{const n=p.map(x=>x.id===id?res.data.data:x);return n;});
  },[]);
  const deleteRoute=useCallback(async (id:string) => {
    const res: any = await api.delete(`/routes/${id}`);
    if (!res.success) throw new Error(res.error || 'Failed to delete route');
    setRoutes(p=>{const n=p.filter(x=>x.id!==id);return n;});
  },[]);
  const addRoutePlan=useCallback(async (p:Omit<RoutePlan,'id'|'created_at'>) => {
    const res: any = await api.post('/route-plans', p);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to create route plan');
    setRoutePlans(prev=>{const n=[...prev,res.data.data];return n;});
  },[]);
  const updateRoutePlan=useCallback(async (id:string,p:Partial<RoutePlan>) => {
    const res: any = await api.put(`/route-plans/${id}`, p);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to update route plan');
    setRoutePlans(prev=>{const n=prev.map(x=>x.id===id?res.data.data:x);return n;});
  },[]);
  const deleteRoutePlan=useCallback(async (id:string) => {
    const res: any = await api.delete(`/route-plans/${id}`);
    if (!res.success) throw new Error(res.error || 'Failed to delete route plan');
    setRoutePlans(prev=>{const n=prev.filter(x=>x.id!==id);return n;});
  },[]);

  // Rates
  const addRate=useCallback(async (r:Omit<Rate,'id'>) => {
    const res: any = await api.post('/rates', r);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to create rate');
    setRates(p=>{const n=[...p,res.data.data];return n;});
  },[]);
  const updateRate=useCallback(async (id:string,r:Partial<Rate>) => {
    const res: any = await api.put(`/rates/${id}`, r);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to update rate');
    setRates(p=>{const n=p.map(x=>x.id===id?res.data.data:x);return n;});
  },[]);
  const deleteRate=useCallback(async (id:string) => {
    const res: any = await api.delete(`/rates/${id}`);
    if (!res.success) throw new Error(res.error || 'Failed to delete rate');
    setRates(p=>{const n=p.filter(x=>x.id!==id);return n;});
  },[]);

  // MCCMNC — server-side paginated fetch
  const fetchMCCMNC=useCallback(async (params?:{search?:string;country?:string;offset?:number;limit?:number}) => {
    const res: any = await api.get('/mccmnc' + (params ? '?' + new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([,v]) => v !== undefined && v !== '').map(([k,v]) => [k, String(v)]))
    ).toString() : ''));
    if (res.success && res.data?.data) {
      setMCCMNC(res.data.data);
      if (typeof res.data.total === 'number') setMCCMNCTotal(res.data.total);
    }
  },[]);

  // MCCMNC — API-wired
  const addMCCMNC=useCallback(async (m:Omit<MCCMNC,'id'>) => {
    const res: any = await api.post('/mccmnc', m);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to create MCCMNC');
    setMCCMNC(p=>{const n=[...p,res.data.data];return n;});
  },[]);
  const updateMCCMNC=useCallback(async (id:string,m:Partial<MCCMNC>) => {
    const res: any = await api.put(`/mccmnc/${id}`, m);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to update MCCMNC');
    setMCCMNC(p=>{const n=p.map(x=>x.id===id?res.data.data:x);return n;});
  },[]);
  const deleteMCCMNC=useCallback(async (id:string) => {
    const res: any = await api.delete(`/mccmnc/${id}`);
    if (!res.success) throw new Error(res.error || 'Failed to delete MCCMNC');
    setMCCMNC(p=>{const n=p.filter(x=>x.id!==id);return n;});
  },[]);

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
  const addOTTDevice=useCallback(async (d:Omit<OTTDevice,'id'|'created_at'>) => {
    const res: any = await api.post('/ott-devices', d);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to create OTT device');
    setOTTDevices(p=>{const n=[...p,res.data.data];return n;});
  },[]);
  const updateOTTDevice=useCallback(async (id:string,d:Partial<OTTDevice>) => {
    const res: any = await api.put(`/ott-devices/${id}`, d);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to update OTT device');
    setOTTDevices(p=>{const n=p.map(x=>x.id===id?res.data.data:x);return n;});
  },[]);
  const deleteOTTDevice=useCallback(async (id:string) => {
    const res: any = await api.delete(`/ott-devices/${id}`);
    if (!res.success) throw new Error(res.error || 'Failed to delete OTT device');
    setOTTDevices(p=>{const n=p.filter(x=>x.id!==id);return n;});
  },[]);
  // API Connectors
  const addApiConnector=useCallback(async (c:Omit<APIConnector,'id'|'created_at'>) => {
    const res: any = await api.post('/api-connectors', c);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to create API connector');
    setApiConnectors(p=>{const n=[...p,res.data.data];return n;});
  },[]);
  const updateApiConnector=useCallback(async (id:string,c:Partial<APIConnector>) => {
    const res: any = await api.put(`/api-connectors/${id}`, c);
    if (!res.success || !res.data?.data) throw new Error(res.error || 'Failed to update API connector');
    setApiConnectors(p=>{const n=p.map(x=>x.id===id?res.data.data:x);return n;});
  },[]);
  const deleteApiConnector=useCallback(async (id:string) => {
    const res: any = await api.delete(`/api-connectors/${id}`);
    if (!res.success) throw new Error(res.error || 'Failed to delete API connector');
    setApiConnectors(p=>{const n=p.filter(x=>x.id!==id);return n;});
  },[]);
  const markNotificationRead=useCallback(async (id:string) => {
    const res: any = await api.put(`/notifications/${id}/read`, {});
    if (!res.success) throw new Error(res.error || 'Failed to mark notification read');
    setNotifications(p=>{const n=p.map(x=>x.id===id?{...x,is_read:true}:x);return n;});
  },[]);
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
  const updatePlatformSetting=useCallback(async (key:string,value:string) => {
    const res: any = await api.put('/platform-settings', { [key]: value });
    if (!res.success) throw new Error(res.error || 'Failed to update platform setting');
    setPlatformSettings(p=>{const n={...p,[key]:value};return n;});
  },[]);
  const updateSMTPConfig=useCallback(async (data:Partial<SMTPConfig>) => {
    const res: any = await api.put('/smtp-config', data);
    if (!res.success) throw new Error(res.error || 'Failed to update SMTP config');
    setSMTPConfig((prev:SMTPConfig)=>{const n={...prev,...data};return n;});
  },[]);
  const updateEmailTemplate=useCallback(async (id:string,data:Partial<EmailTemplate>) => {
    const res: any = await api.put(`/notification-templates/${id}`, data);
    if (!res.success) throw new Error(res.error || 'Failed to update email template');
    setEmailTemplates(p=>{const n=p.map(t=>t.id===id?{...t,...data}:t);return n;});
  },[]);

  const getClientById=(id:string)=>clients.find(c=>String(c.id)===String(id));
  const getSupplierById=(id:string)=>suppliers.find(s=>String(s.id)===String(id));
  const getTrunkById=(id:string)=>trunks.find(t=>String(t.id)===String(id));

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

  return (<DataContext.Provider value={{clients,suppliers,trunks,routes,routePlans,rates,mccmnc,invoices,payments,smsLogs,ottDevices,apiConnectors,users,emailTemplates,notifications,campaigns,translations,voiceOTPConfigs,dashboardStats,hourlyTraffic:hourlyTrafficData,dailyRevenue:dailyRevenueData,topDest:topDestinations,addClient,updateClient,deleteClient,restoreClient,addSupplier,updateSupplier,deleteSupplier,restoreSupplier,addSMSLog,addTrunk,updateTrunk,deleteTrunk,addRoute,updateRoute,deleteRoute,addRoutePlan,updateRoutePlan,deleteRoutePlan,addRate,updateRate,deleteRate,addMCCMNC,updateMCCMNC,deleteMCCMNC,addInvoice,updateInvoice,addPayment,addOTTDevice,updateOTTDevice,deleteOTTDevice,addApiConnector,updateApiConnector,deleteApiConnector,markNotificationRead,addCampaign,updateCampaign,deleteCampaign,addTranslation,updateTranslation,deleteTranslation,          getClientById,getSupplierById,getTrunkById,updateEmailTemplate,platformSettings,updatePlatformSetting,smtpConfig,updateSMTPConfig,dlrQueue,mccmncTotal,fetchMCCMNC,smsTotal,fetchSMSLogs}}>{children}</DataContext.Provider>);
};

export const useData = () => { const c=useContext(DataContext); if(!c) throw new Error('useData required'); return c; };
