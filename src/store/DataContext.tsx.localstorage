import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { Client, Supplier, Trunk, Route, RoutePlan, Rate, MCCMNC, Invoice, Payment, SMSLog, EmailTemplate, OTTDevice, APIConnector, User, DashboardStats, Notification, Campaign, Translation, VoiceOTPConfig } from '../types';
import { mockRoutes, mockUsers, hourlyTrafficData, dailyRevenueData, topDestinations } from './mockData';

// Database persistence — localStorage keys (PostgreSQL via API in production)
const DB = {
  clients: 'clients_db', suppliers: 'suppliers_db', sms_logs: 'sms_logs_db',
  trunks: 'trunks_db', routes: 'routes_db', route_plans: 'route_plans_db',
  rates: 'rates_db', mccmnc: 'mccmnc_db', invoices: 'invoices_db', payments: 'payments_db',
  campaigns: 'campaigns_db', translations: 'translations_db', notifications: 'notifications_db',
  ott_devices: 'ott_devices_db', platform_settings: 'platform_settings_db', smtp_config: 'smtp_config_db',
  voice_otp_configs: 'voice_otp_configs_db', email_templates: 'email_templates_db',
};
function load<T>(key: string, fallback: T): T { try { const s=localStorage.getItem(key); if(s) return JSON.parse(s); } catch{} localStorage.setItem(key, JSON.stringify(fallback)); return fallback; }
function save(key: string, v: any) { localStorage.setItem(key, JSON.stringify(v)); }

const ONE_CLIENT: Client = { id:'1',client_code:'CLT001',company_name:'TechCorp Global',contact_person:'John Smith',email:'john@techcorp.com',phone:'+1234567890',address:'123 Tech Street, Silicon Valley',country:'USA',smpp_username:'techcorp_smpp',smpp_password:'secure123',smpp_ip:'0.0.0.0',smpp_port:2775,system_type:'SMPP',max_tps:100,billing_mode:'dlr',currency:'EUR',balance:5000,credit_limit:10000,api_enabled:true,webhook_url:'',force_dlr:true,routing_plan_id:'1',rate_plan_id:'1',status:'active',created_at:'2024-01-15T10:00:00Z',updated_at:'2024-01-15T10:00:00Z'};
const ONE_SUPPLIER: Supplier = { id:'1',supplier_code:'SUP001',company_name:'GlobalSMS Gateway',contact_person:'Alex Turner',email:'alex@globalsms.com',phone:'+1111222233',connection_type:'smpp',smpp_host:'smpp.globalsms.com',smpp_port:2775,smpp_username:'net2app_client',smpp_password:'gateway123',system_id:'NET2APP',api_url:'',api_key:'',api_method:'POST',balance:50000,credit_limit:100000,currency:'EUR',bind_status:'bound',status:'active',consecutive_failures:0,created_at:'2024-01-01T00:00:00Z',updated_at:'2024-03-20T12:00:00Z'};

interface DataContextType {
  clients: Client[]; suppliers: Supplier[]; trunks: Trunk[]; routes: Route[]; routePlans: RoutePlan[];
  rates: Rate[]; mccmnc: MCCMNC[]; invoices: Invoice[]; payments: Payment[]; smsLogs: SMSLog[];
  ottDevices: OTTDevice[]; apiConnectors: APIConnector[]; users: User[];
  emailTemplates: EmailTemplate[]; notifications: Notification[]; campaigns: Campaign[];
  translations: Translation[]; voiceOTPConfigs: VoiceOTPConfig[];
  dashboardStats: DashboardStats; hourlyTraffic: typeof hourlyTrafficData; dailyRevenue: typeof dailyRevenueData; topDest: typeof topDestinations;
  addClient:(c:Omit<Client,'id'|'created_at'|'updated_at'>)=>void; updateClient:(id:string,c:Partial<Client>)=>void; deleteClient:(id:string)=>void;
  addSupplier:(s:Omit<Supplier,'id'|'created_at'|'updated_at'>)=>void; updateSupplier:(id:string,s:Partial<Supplier>)=>void; deleteSupplier:(id:string)=>void;
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
  const [clients, setClients] = useState<Client[]>(()=>load(DB.clients,[ONE_CLIENT]));
  const [suppliers, setSuppliers] = useState<Supplier[]>(()=>load(DB.suppliers,[ONE_SUPPLIER]));
  const [trunks, setTrunks] = useState<Trunk[]>(()=>load(DB.trunks,[]));
  const [routes, setRoutes] = useState<Route[]>(()=>load(DB.routes,mockRoutes));
  const [routePlans, setRoutePlans] = useState<RoutePlan[]>(()=>load(DB.route_plans,[]));
  const [rates, setRates] = useState<Rate[]>(()=>load(DB.rates,[]));
  const [mccmnc, setMCCMNC] = useState<MCCMNC[]>(()=>load(DB.mccmnc,[]));
  const [invoices, setInvoices] = useState<Invoice[]>(()=>load(DB.invoices,[]));
  const [payments, setPayments] = useState<Payment[]>(()=>load(DB.payments,[]));
  const [smsLogs, setSMSLogs] = useState<SMSLog[]>(()=>load(DB.sms_logs,[]));
  const [ottDevices, setOTTDevices] = useState<OTTDevice[]>(()=>load(DB.ott_devices,[]));
  const [notifications, setNotifications] = useState<Notification[]>(()=>load(DB.notifications,[]));
  const [campaigns, setCampaigns] = useState<Campaign[]>(()=>load(DB.campaigns,[]));
  const [translations, setTranslations] = useState<Translation[]>(()=>load(DB.translations,[]));
  const [voiceOTPConfigs] = useState<VoiceOTPConfig[]>(()=>load(DB.voice_otp_configs,[]));
  const [platformSettings, setPlatformSettings] = useState<Record<string,string>>(()=>load(DB.platform_settings,{platform_name:'NET2APP Hub',currency:'EUR',default_tax_rate:'19.00'}));
  const [smtpConfig, setSMTPConfig] = useState<any>(()=>load(DB.smtp_config,{host:'smtp.gmail.com',port:587,encryption:'tls'}));
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>(()=>load(DB.email_templates,[]));

  // Client CRUD — persist to DB
  const addClient=useCallback((c:Omit<Client,'id'|'created_at'|'updated_at'>)=>{setClients(p=>{const n=[...p,{...c,id:gid(),created_at:nw(),updated_at:nw()}];save(DB.clients,n);return n;});},[]);
  const updateClient=useCallback((id:string,c:Partial<Client>)=>{setClients(p=>{const n=p.map(x=>x.id===id?{...x,...c,updated_at:nw()}:x);save(DB.clients,n);return n;});},[]);
  const deleteClient=useCallback((id:string)=>{setClients(p=>{const n=p.filter(x=>x.id!==id);save(DB.clients,n);return n;});},[]);

  // Supplier CRUD
  const addSupplier=useCallback((s:Omit<Supplier,'id'|'created_at'|'updated_at'>)=>{setSuppliers(p=>{const n=[...p,{...s,id:gid(),created_at:nw(),updated_at:nw()}];save(DB.suppliers,n);return n;});},[]);
  const updateSupplier=useCallback((id:string,s:Partial<Supplier>)=>{setSuppliers(p=>{const n=p.map(x=>x.id===id?{...x,...s,updated_at:nw()}:x);save(DB.suppliers,n);return n;});},[]);
  const deleteSupplier=useCallback((id:string)=>{setSuppliers(p=>{const n=p.filter(x=>x.id!==id);save(DB.suppliers,n);return n;});},[]);

  // SMS Logs
  const addSMSLog=useCallback((log:Omit<SMSLog,'id'|'created_at'|'submit_time'>)=>{const nl:SMSLog={...log,id:gid(),submit_time:nw(),created_at:nw(),supplier_id:log.supplier_id??null,supplier_code:log.supplier_code??null,dlr_status:log.dlr_status??null,dlr_timestamp:log.dlr_timestamp??null,delivery_time:log.delivery_time??null,error_code:log.error_code??null,error_message:log.error_message??null,route_name:log.route_name??null,trunk_name:log.trunk_name??null};setSMSLogs(p=>{const n=[nl,...p];save(DB.sms_logs,n);return n;});},[]);

  // Trunks, Routes, Plans
  const addTrunk=useCallback((t:Omit<Trunk,'id'|'created_at'>)=>{setTrunks(p=>{const n=[...p,{...t,id:gid(),created_at:nw()}];save(DB.trunks,n);return n;});},[]);
  const updateTrunk=useCallback((id:string,t:Partial<Trunk>)=>{setTrunks(p=>{const n=p.map(x=>x.id===id?{...x,...t}:x);save(DB.trunks,n);return n;});},[]);
  const deleteTrunk=useCallback((id:string)=>{setTrunks(p=>{const n=p.filter(x=>x.id!==id);save(DB.trunks,n);return n;});},[]);
  const addRoute=useCallback((r:Omit<Route,'id'|'created_at'>)=>{setRoutes(p=>{const n=[...p,{...r,id:gid(),created_at:nw()}];save(DB.routes,n);return n;});},[]);
  const updateRoute=useCallback((id:string,r:Partial<Route>)=>{setRoutes(p=>{const n=p.map(x=>x.id===id?{...x,...r}:x);save(DB.routes,n);return n;});},[]);
  const deleteRoute=useCallback((id:string)=>{setRoutes(p=>{const n=p.filter(x=>x.id!==id);save(DB.routes,n);return n;});},[]);
  const addRoutePlan=useCallback((p:Omit<RoutePlan,'id'|'created_at'>)=>{setRoutePlans(prev=>{const n=[...prev,{...p,id:gid(),created_at:nw()}];save(DB.route_plans,n);return n;});},[]);
  const updateRoutePlan=useCallback((id:string,p:Partial<RoutePlan>)=>{setRoutePlans(prev=>{const n=prev.map(x=>x.id===id?{...x,...p}:x);save(DB.route_plans,n);return n;});},[]);
  const deleteRoutePlan=useCallback((id:string)=>{setRoutePlans(prev=>{const n=prev.filter(x=>x.id!==id);save(DB.route_plans,n);return n;});},[]);

  // Rates
  const addRate=useCallback((r:Omit<Rate,'id'>)=>{setRates(p=>{const n=[...p,{...r,id:gid()}];save(DB.rates,n);return n;});},[]);
  const updateRate=useCallback((id:string,r:Partial<Rate>)=>{setRates(p=>{const n=p.map(x=>x.id===id?{...x,...r}:x);save(DB.rates,n);return n;});},[]);
  const deleteRate=useCallback((id:string)=>{setRates(p=>{const n=p.filter(x=>x.id!==id);save(DB.rates,n);return n;});},[]);

  // MCCMNC
  const addMCCMNC=useCallback((m:Omit<MCCMNC,'id'>)=>{setMCCMNC(p=>{const n=[...p,{...m,id:gid()}];save(DB.mccmnc,n);return n;});},[]);
  const updateMCCMNC=useCallback((id:string,m:Partial<MCCMNC>)=>{setMCCMNC(p=>{const n=p.map(x=>x.id===id?{...x,...m}:x);save(DB.mccmnc,n);return n;});},[]);
  const deleteMCCMNC=useCallback((id:string)=>{setMCCMNC(p=>{const n=p.filter(x=>x.id!==id);save(DB.mccmnc,n);return n;});},[]);

  // Invoices, Payments
  const addInvoice=useCallback((i:Omit<Invoice,'id'|'created_at'>)=>{setInvoices(p=>{const n=[...p,{...i,id:gid(),created_at:nw()}];save(DB.invoices,n);return n;});},[]);
  const updateInvoice=useCallback((id:string,i:Partial<Invoice>)=>{setInvoices(p=>{const n=p.map(x=>x.id===id?{...x,...i}:x);save(DB.invoices,n);return n;});},[]);
  const addPayment=useCallback((p:Omit<Payment,'id'|'created_at'>)=>{setPayments(prev=>{const n=[...prev,{...p,id:gid(),created_at:nw()}];save(DB.payments,n);return n;});},[]);

  // OTT, Notifications, Campaigns, Translations
  const addOTTDevice=useCallback((d:Omit<OTTDevice,'id'|'created_at'>)=>{setOTTDevices(p=>{const n=[...p,{...d,id:gid(),created_at:nw()}];save(DB.ott_devices,n);return n;});},[]);
  const updateOTTDevice=useCallback((id:string,d:Partial<OTTDevice>)=>{setOTTDevices(p=>{const n=p.map(x=>x.id===id?{...x,...d}:x);save(DB.ott_devices,n);return n;});},[]);
  const deleteOTTDevice=useCallback((id:string)=>{setOTTDevices(p=>{const n=p.filter(x=>x.id!==id);save(DB.ott_devices,n);return n;});},[]);
  const markNotificationRead=useCallback((id:string)=>{setNotifications(p=>{const n=p.map(x=>x.id===id?{...x,is_read:true}:x);save(DB.notifications,n);return n;});},[]);
  const addCampaign=useCallback((c:Omit<Campaign,'id'|'created_at'>)=>{setCampaigns(p=>{const n=[...p,{...c,id:gid(),created_at:nw()}];save(DB.campaigns,n);return n;});},[]);
  const updateCampaign=useCallback((id:string,c:Partial<Campaign>)=>{setCampaigns(p=>{const n=p.map(x=>x.id===id?{...x,...c}:x);save(DB.campaigns,n);return n;});},[]);
  const deleteCampaign=useCallback((id:string)=>{setCampaigns(p=>{const n=p.filter(x=>x.id!==id);save(DB.campaigns,n);return n;});},[]);
  const addTranslation=useCallback((t:Omit<Translation,'id'|'created_at'>)=>{setTranslations(p=>{const n=[...p,{...t,id:gid(),created_at:nw()}];save(DB.translations,n);return n;});},[]);
  const updateTranslation=useCallback((id:string,t:Partial<Translation>)=>{setTranslations(p=>{const n=p.map(x=>x.id===id?{...x,...t}:x);save(DB.translations,n);return n;});},[]);
  const deleteTranslation=useCallback((id:string)=>{setTranslations(p=>{const n=p.filter(x=>x.id!==id);save(DB.translations,n);return n;});},[]);

  // Settings
  const updatePlatformSetting=useCallback((key:string,value:string)=>{setPlatformSettings(p=>{const n={...p,[key]:value};save(DB.platform_settings,n);return n;});},[]);
  const updateSMTPConfig=useCallback((data:any)=>{setSMTPConfig(prev=>{const n={...prev,...data};save(DB.smtp_config,n);return n;});},[]);
  const updateEmailTemplate=useCallback((id:string,data:Partial<EmailTemplate>)=>{setEmailTemplates(p=>{const n=p.map(t=>t.id===id?{...t,...data}:t);save(DB.email_templates,n);return n;});},[]);

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
