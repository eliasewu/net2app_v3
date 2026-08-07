import React, { useState, useEffect } from 'react';
import { Zap, CheckCircle, ArrowRight, ArrowLeft, Plus, Server, GitBranch, MapPin, Layers, UserPlus, Percent } from 'lucide-react';
import { Card } from '../UI/Card';
import { Button } from '../UI/Button';
import { Input, Select } from '../UI/Input';
import { Badge } from '../UI/Badge';
import { suppliersApi, clientsApi, routingApi, ratesApi } from '../../services/api';

const STEP_ICONS = [Server, GitBranch, MapPin, Layers];
const STEP_LABELS = ['Supplier', 'Trunk', 'Route', 'Route Plan'];
const CLIENT_STEP_ICONS = [UserPlus, Percent, Layers];
const CLIENT_LABELS = ['Client', 'Rate', 'Route Plan'];

export const QuickWizard: React.FC = () => {
  const [mode, setMode] = useState<'supplier' | 'client' | null>(null);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  // Supplier wizard state
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [routePlans, setRoutePlans] = useState<any[]>([]);
  const [createNewSupplier, setCreateNewSupplier] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [supplierForm, setSupplierForm] = useState({ supplier_code: '', company_name: '', connection_type: 'smpp', smpp_host: '', smpp_port: '2775', smpp_username: '', smpp_password: '' });
  const [trunkName, setTrunkName] = useState('');
  const [routeMcc, setRouteMcc] = useState('');
  const [routeMnc, setRouteMnc] = useState('');
  const [routeRate, setRouteRate] = useState('0.01');
  const [routePlanId, setRoutePlanId] = useState('');
  const [createNewPlan, setCreateNewPlan] = useState(false);
  const [planName, setPlanName] = useState('');
  const [createdIds, setCreatedIds] = useState<{supplier?: number; trunk?: number; route?: number; plan?: number}>({});

  // Client wizard state
  const [clientForm, setClientForm] = useState({ client_code: '', company_name: '', smpp_username: '', smpp_password: '' });
  const [clientRate, setClientRate] = useState('0.02');
  const [clientPlanId, setClientPlanId] = useState('');

  useEffect(() => {
    if (!mode) return;
    Promise.all([
      suppliersApi.getAll().then(r => { if (r.success && r.data?.data) setSuppliers(r.data.data); else if (r.success && Array.isArray(r.data)) setSuppliers(r.data); }),
      routingApi.getRoutePlans().then(r => { if (r.success && r.data?.data) setRoutePlans(r.data.data); else if (r.success && Array.isArray(r.data)) setRoutePlans(r.data); }),
    ]).catch(() => {});
  }, [mode]);

  const nextStep = () => setStep(s => Math.min(s + 1, mode === 'supplier' ? 3 : 2));
  const prevStep = () => setStep(s => Math.max(s - 1, 0));

  const handleSupplier = async () => {
    setLoading(true); setError('');
    try {
      let sid = supplierId;
      if (createNewSupplier || !sid) {
        const r = await suppliersApi.create(supplierForm) as any;
        if (!r.success) throw new Error(r.error || 'Failed to create supplier');
        sid = r.data?.data?.id || r.data?.id;
        setSupplierId(String(sid));
        setCreatedIds(p => ({...p, supplier: Number(sid)}));
      }
      setTrunkName(`${supplierForm.supplier_code || 'new'}_trunk`);
      nextStep();
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  const handleTrunk = async () => {
    setLoading(true); setError('');
    try {
      const r = await routingApi.createTrunk({
        trunk_name: trunkName,
        supplier_id: Number(supplierId),
        trunk_type: 'sim_otp',
        is_active: true,
      }) as any;
      if (!r.success) throw new Error(r.error || 'Failed to create trunk');
      const tid = r.data?.data?.id || r.data?.id;
      setCreatedIds(p => ({...p, trunk: Number(tid)}));
      nextStep();
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  const handleRoute = async () => {
    setLoading(true); setError('');
    try {
      const r = await routingApi.createRoute({
        route_name: `${supplierForm.supplier_code || 'new'}_route`,
        mcc: routeMcc || '*',
        mnc: routeMnc || '*',
        supplier_rate: parseFloat(routeRate) || 0.01,
        trunk_ids: [createdIds.trunk],
        is_active: true,
      }) as any;
      if (!r.success) throw new Error(r.error || 'Failed to create route');
      const rid = r.data?.data?.id || r.data?.id;
      setCreatedIds(p => ({...p, route: Number(rid)}));
      setPlanName(`${supplierForm.supplier_code || 'new'}_plan`);
      nextStep();
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  const handlePlan = async () => {
    setLoading(true); setError('');
    try {
      let pid = routePlanId;
      if (createNewPlan || !pid) {
        const r = await routingApi.createRoutePlan({
          plan_name: planName,
          route_ids: [createdIds.route],
        }) as any;
        if (!r.success) throw new Error(r.error || 'Failed to create route plan');
        pid = r.data?.data?.id || r.data?.id;
        setCreatedIds(p => ({...p, plan: Number(pid)}));
      }
      setDone(true);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  const handleClient = async () => {
    setLoading(true); setError('');
    try {
      // Step 1: Create client
      if (step === 0) {
        const r = await clientsApi.create(clientForm) as any;
        if (!r.success) throw new Error(r.error || 'Failed to create client');
        const cid = r.data?.data?.id || r.data?.id;
        setCreatedIds(p => ({...p, supplier: Number(cid)})); // reuse supplier field for client id
        nextStep();
      }
      // Step 2: Add rate
      else if (step === 1) {
        const r = await ratesApi.create({
          entity_type: 'client',
          entity_id: Number(createdIds.supplier),
          mcc: '*',
          mnc: '*',
          rate: parseFloat(clientRate) || 0.02,
          is_active: true,
        }) as any;
        if (!r.success) throw new Error(r.error || 'Failed to add rate');
        nextStep();
      }
      // Step 3: Assign to route plan
      else if (step === 2) {
        if (clientPlanId) {
          await clientsApi.update(String(createdIds.supplier), { routing_plan_id: Number(clientPlanId) }) as any;
        }
        setDone(true);
      }
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  if (done) return (
    <Card>
      <div className="text-center py-8">
        <CheckCircle size={48} className="mx-auto text-green-500 mb-3" />
        <h3 className="text-lg font-semibold text-gray-800">Setup Complete!</h3>
        <p className="text-sm text-gray-500 mt-1">
          {mode === 'supplier' ? (
            <>Supplier pipeline created: {supplierForm.supplier_code || '—'} → Trunk → Route → Route Plan</>
          ) : (
            <>Client ready: {clientForm.client_code || '—'} with rate and route plan</>
          )}
        </p>
        <Button variant="secondary" className="mt-4" onClick={() => { setMode(null); setStep(0); setDone(false); setCreatedIds({}); setSupplierId(''); setRoutePlanId(''); }}>Start New</Button>
      </div>
    </Card>
  );

  if (!mode) return (
    <Card title="Quick Setup Wizard" subtitle="Create a full pipeline in seconds">
      <div className="grid grid-cols-2 gap-4">
        <button onClick={() => setMode('supplier')} className="p-6 border-2 border-dashed border-gray-200 rounded-xl hover:border-blue-400 hover:bg-blue-50 transition text-left">
          <Server size={32} className="text-blue-500 mb-3" />
          <h4 className="font-semibold">Quick Supplier Setup</h4>
          <p className="text-sm text-gray-500 mt-1">Supplier → Trunk → Route → Route Plan in one flow</p>
        </button>
        <button onClick={() => setMode('client')} className="p-6 border-2 border-dashed border-gray-200 rounded-xl hover:border-green-400 hover:bg-green-50 transition text-left">
          <UserPlus size={32} className="text-green-500 mb-3" />
          <h4 className="font-semibold">Quick Client Setup</h4>
          <p className="text-sm text-gray-500 mt-1">Client → Rate → Route Plan in one flow</p>
        </button>
      </div>
    </Card>
  );

  const steps = mode === 'supplier'
    ? [handleSupplier, handleTrunk, handleRoute, handlePlan]
    : [handleClient, handleClient, handleClient];

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Zap size={18} className="text-amber-500" />
          <h3 className="font-semibold text-gray-800">{mode === 'supplier' ? 'Quick Supplier Setup' : 'Quick Client Setup'}</h3>
        </div>
        <Button variant="secondary" size="sm" onClick={() => { setMode(null); setStep(0); }}>Cancel</Button>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2 mb-6">
        {(mode === 'supplier' ? STEP_LABELS : CLIENT_LABELS).map((label, i) => {
          const Icon = mode === 'supplier' ? STEP_ICONS[i] : CLIENT_STEP_ICONS[i];
          const active = i === step; const done = i < step;
          return <React.Fragment key={i}>
            {i > 0 && <div className={`flex-1 h-0.5 ${done ? 'bg-green-400' : 'bg-gray-200'}`} />}
            <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${active ? 'bg-blue-100 text-blue-700' : done ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
              {done ? <CheckCircle size={12} /> : <Icon size={12} />} {label}
            </div>
          </React.Fragment>;
        })}
      </div>

      {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm mb-3">{error}</div>}

      {mode === 'supplier' && (
        <>
          {/* Step 0: Supplier */}
          {step === 0 && <div className="space-y-3">
            <Select label="Select Existing Supplier" value={supplierId} onChange={e => { setSupplierId(e.target.value); setCreateNewSupplier(false); }}
              options={[{value:'',label:'— Create New —'}, ...suppliers.map((s:any) => ({value:String(s.id),label:`${s.supplier_code} (${s.company_name||s.smpp_host||''})`}))]} />
            {(createNewSupplier || !supplierId) && <>
              <div className="border-l-2 border-blue-400 pl-3 py-1"><p className="text-xs text-blue-600 font-medium">New Supplier</p></div>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Code *" value={supplierForm.supplier_code} onChange={e => setSupplierForm(p=>({...p,supplier_code:e.target.value}))} placeholder="MYSUPP" />
                <Input label="Company" value={supplierForm.company_name} onChange={e => setSupplierForm(p=>({...p,company_name:e.target.value}))} placeholder="My Supplier Ltd" />
                <Input label="SMPP Host" value={supplierForm.smpp_host} onChange={e => setSupplierForm(p=>({...p,smpp_host:e.target.value}))} placeholder="192.168.1.1" />
                <Input label="Port" value={supplierForm.smpp_port} onChange={e => setSupplierForm(p=>({...p,smpp_port:e.target.value}))} placeholder="2775" />
                <Input label="Username" value={supplierForm.smpp_username} onChange={e => setSupplierForm(p=>({...p,smpp_username:e.target.value}))} />
                <Input label="Password" value={supplierForm.smpp_password} onChange={e => setSupplierForm(p=>({...p,smpp_password:e.target.value}))} />
              </div>
            </>}
          </div>}

          {/* Step 1: Trunk */}
          {step === 1 && <div className="space-y-3">
            <Input label="Trunk Name" value={trunkName} onChange={e => setTrunkName(e.target.value)} placeholder="my_trunk" />
            <p className="text-xs text-gray-400">Links supplier <Badge size="sm">{supplierForm.supplier_code || `#${supplierId}`}</Badge> to routes</p>
          </div>}

          {/* Step 2: Route */}
          {step === 2 && <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Input label="MCC" value={routeMcc} onChange={e => setRouteMcc(e.target.value)} placeholder="* (all)" />
              <Input label="MNC" value={routeMnc} onChange={e => setRouteMnc(e.target.value)} placeholder="* (all)" />
              <Input label="Supplier Rate €" type="number" value={routeRate} onChange={e => setRouteRate(e.target.value)} placeholder="0.01" />
            </div>
            <p className="text-xs text-gray-400">Points to trunk: <Badge size="sm" variant="info">{trunkName}</Badge></p>
          </div>}

          {/* Step 3: Route Plan */}
          {step === 3 && <div className="space-y-3">
            <Select label="Select Route Plan" value={routePlanId} onChange={e => { setRoutePlanId(e.target.value); setCreateNewPlan(false); }}
              options={[{value:'',label:'— Create New —'}, ...routePlans.map((p:any) => ({value:String(p.id),label:p.plan_name || p.name}))]} />
            {(createNewPlan || !routePlanId) && <Input label="Plan Name" value={planName} onChange={e => setPlanName(e.target.value)} placeholder="my_plan" />}
          </div>}
        </>
      )}

      {mode === 'client' && (
        <>
          {step === 0 && <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Client Code *" value={clientForm.client_code} onChange={e => setClientForm(p=>({...p,client_code:e.target.value}))} placeholder="MYCLIENT" />
              <Input label="Company Name" value={clientForm.company_name} onChange={e => setClientForm(p=>({...p,company_name:e.target.value}))} placeholder="My Client Ltd" />
              <Input label="SMPP Username" value={clientForm.smpp_username} onChange={e => setClientForm(p=>({...p,smpp_username:e.target.value}))} />
              <Input label="SMPP Password" value={clientForm.smpp_password} onChange={e => setClientForm(p=>({...p,smpp_password:e.target.value}))} />
            </div>
          </div>}
          {step === 1 && <div className="space-y-3">
            <Input label="Client Rate (€)" type="number" value={clientRate} onChange={e => setClientRate(e.target.value)} placeholder="0.02" />
            <p className="text-xs text-gray-400">Rate applied to all destinations (MCC=*)</p>
          </div>}
          {step === 2 && <div className="space-y-3">
            <Select label="Assign to Route Plan" value={clientPlanId} onChange={e => setClientPlanId(e.target.value)}
              options={[{value:'',label:'— Skip —'}, ...routePlans.map((p:any) => ({value:String(p.id),label:p.plan_name || p.name}))]} />
          </div>}
        </>
      )}

      {/* Navigation */}
      <div className="flex justify-between mt-6 pt-4 border-t border-gray-100">
        <Button variant="secondary" onClick={prevStep} disabled={step === 0} icon={<ArrowLeft size={14} />}>Back</Button>
        <Button onClick={steps[step]} loading={loading} icon={step === (mode === 'supplier' ? 3 : 2) ? <CheckCircle size={14} /> : <ArrowRight size={14} />}>
          {step === (mode === 'supplier' ? 3 : 2) ? 'Finish' : 'Next'}
        </Button>
      </div>
    </Card>
  );
};
