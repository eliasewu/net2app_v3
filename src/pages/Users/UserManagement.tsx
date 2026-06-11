import React, { useState } from 'react';
import { Search, Edit, Trash2, UserPlus, AlertTriangle, X, Shield, Lock, Settings } from 'lucide-react';
import { useAuth, User } from '../../store/AuthContext';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Badge } from '../../components/UI/Badge';
import { Table, Pagination } from '../../components/UI/Table';
import { Modal } from '../../components/UI/Modal';
import { Input, Select } from '../../components/UI/Input';

const roleLabels: Record<string,string> = { super_admin:'Super Admin', admin:'Admin', support:'Support', billing:'Billing', agent:'Agent', client:'Client', supplier:'Supplier' };

// Permissions by role
const ALL_PERMISSIONS = [
  { key:'all', label:'All Access (Super Admin)', desc:'Full platform access' },
  { key:'manage_clients', label:'Manage Clients', desc:'Add, edit, delete clients' },
  { key:'manage_suppliers', label:'Manage Suppliers', desc:'Add, edit, delete suppliers' },
  { key:'manage_rates', label:'Manage Rates', desc:'Create and update rates' },
  { key:'manage_routes', label:'Manage Routes', desc:'Configure routing' },
  { key:'manage_billing', label:'Manage Billing', desc:'Invoices, payments' },
  { key:'manage_invoices', label:'Manage Invoices', desc:'Generate and send invoices' },
  { key:'manage_payments', label:'Manage Payments', desc:'Record payments' },
  { key:'manage_users', label:'Manage Users', desc:'Add/edit/delete users' },
  { key:'manage_bind', label:'Manage Binds', desc:'SMPP bind/unbind' },
  { key:'manage_license', label:'Manage License', desc:'License and tenants' },
  { key:'view_clients', label:'View Clients', desc:'Read-only client access' },
  { key:'view_suppliers', label:'View Suppliers', desc:'Read-only supplier access' },
  { key:'view_sms_logs', label:'View SMS Logs', desc:'View CDR' },
  { key:'view_reports', label:'View Reports', desc:'View all reports' },
  { key:'view_own_cdr', label:'View Own CDR', desc:'Client/supplier own CDR' },
  { key:'view_own_usage', label:'View Own Usage', desc:'Own usage stats' },
  { key:'view_own_payments', label:'View Own Payments', desc:'Own payment history' },
  { key:'test_sms', label:'Test SMS', desc:'Send test messages' },
  { key:'send_sms', label:'Send SMS', desc:'Send production SMS' },
];

// Role-specific permission sets
const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  super_admin: ['all'],
  admin: ['manage_clients','manage_suppliers','manage_rates','manage_routes','manage_billing','manage_invoices','manage_payments','manage_bind','view_clients','view_suppliers','view_sms_logs','view_reports','test_sms'],
  support: ['view_clients','view_suppliers','view_sms_logs','test_sms','manage_bind','view_reports'],
  billing: ['manage_invoices','manage_payments','view_reports','view_clients','view_suppliers'],
  agent: ['view_clients','view_suppliers','view_sms_logs','test_sms'],
  client: ['view_own_cdr','view_own_usage','view_own_payments','test_sms','send_sms'],
  supplier: ['view_own_cdr','view_own_usage','view_own_payments','view_bind_status'],
};

export const UserManagement: React.FC = () => {
  const { getVisibleUsers, addUser, updateUser, deleteUser, toggleUserBlock, resetPassword, changeOwnPassword, user: currentUser } = useAuth();
  const users = getVisibleUsers();
  const isSuperAdmin = currentUser?.role === 'super_admin';
  const isAdmin = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';

  const [showModal, setShowModal] = useState(false);
  const [showPwdModal, setShowPwdModal] = useState(false);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [showOwnPwdModal, setShowOwnPwdModal] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [pwdTarget, setPwdTarget] = useState<User | null>(null);
  const [permissionTarget, setPermissionTarget] = useState<User | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const [ownCurrentPwd, setOwnCurrentPwd] = useState('');
  const [ownNewPwd, setOwnNewPwd] = useState('');
  const [ownPwdError, setOwnPwdError] = useState('');
  const [selectedPerms, setSelectedPerms] = useState<string[]>([]);
  const [form, setForm] = useState({ username:'', password:'', email:'', role:'client' as User['role'], name:'' });
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  const filtered = users.filter(u => u.username.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()));
  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginated = filtered.slice((currentPage-1)*itemsPerPage, currentPage*itemsPerPage);

  // Filter roles based on who is creating: admin cannot create super_admin
  const availableRoles = isSuperAdmin
    ? Object.entries(roleLabels).map(([v,l]) => ({ value:v, label:l }))
    : Object.entries(roleLabels).filter(([v]) => v !== 'super_admin').map(([v,l]) => ({ value:v, label:l }));

  const openAdd = () => { setEditing(null); setForm({ username:'', password:'', email:'', role:isSuperAdmin?'admin':'client', name:'' }); setShowModal(true); };
  
  const openEdit = (u: User) => {
    // Admin can only edit non-super_admin users
    if (!isSuperAdmin && u.role === 'super_admin') { alert('You cannot edit Super Admin users'); return; }
    setEditing(u); setForm({ username:u.username, password:'', email:u.email, role:u.role, name:u.name||'' }); setShowModal(true);
  };

  const openPermissions = (u: User) => {
    // Admin can only edit permissions of non-super_admin users
    if (!isSuperAdmin && u.role === 'super_admin') { alert('You cannot modify Super Admin permissions'); return; }
    setPermissionTarget(u); setSelectedPerms([...u.permissions]); setShowPermissionModal(true);
  };

  const handleSave = () => {
    if (!form.username || !form.email) { alert('Username and Email required'); return; }
    // Admin cannot set role to super_admin
    if (!isSuperAdmin && form.role === 'super_admin') { alert('Only Super Admin can create Super Admin accounts'); return; }
    if (editing) {
      updateUser(editing.id, { username:form.username, email:form.email, role:form.role, name:form.name });
      if (form.password) resetPassword(editing.id, form.password);
    } else {
      if (!form.password) { alert('Password required'); return; }
      addUser({ username:form.username, email:form.email, role:form.role, name:form.name, permissions: DEFAULT_PERMISSIONS[form.role] || [] }, form.password);
    }
    setShowModal(false);
  };

  const handleSavePermissions = () => {
    if (!permissionTarget) return;
    updateUser(permissionTarget.id, { permissions: selectedPerms });
    setShowPermissionModal(false);
  };

  const handleChangeOwnPassword = () => {
    if (!ownCurrentPwd || !ownNewPwd) { setOwnPwdError('Both fields required'); return; }
    if (ownNewPwd.length < 4) { setOwnPwdError('Password too short (min 4)'); return; }
    const ok = changeOwnPassword(ownCurrentPwd, ownNewPwd);
    if (ok) { setShowOwnPwdModal(false); setOwnCurrentPwd(''); setOwnNewPwd(''); setOwnPwdError(''); alert('Password changed successfully!'); }
    else { setOwnPwdError('Current password is incorrect'); }
  };

  const togglePerm = (perm: string) => {
    setSelectedPerms(prev => prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]);
  };

  const handleBlockUser = (u: User) => {
    if (!isSuperAdmin && u.role === 'super_admin') { alert('You cannot block Super Admin users'); return; }
    if (u.id === currentUser?.id) { alert('Cannot block yourself'); return; }
    toggleUserBlock(u.id);
  };

  const handleDeleteUser = (u: User) => {
    if (!isSuperAdmin && u.role === 'super_admin') { alert('You cannot delete Super Admin users'); return; }
    if (u.id === currentUser?.id) { alert('Cannot delete yourself'); return; }
    if (window.confirm(`Delete "${u.username}"? This cannot be undone.`)) deleteUser(u.id);
  };

  const columns = [
    {key:'user',header:'User',render:(u:User)=><div className="flex items-center gap-3"><div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${u.is_active?'bg-gradient-to-br from-blue-500 to-indigo-600':'bg-gray-400'}`}>{u.username[0].toUpperCase()}</div><div><p className="font-medium text-sm">{u.username}{u.id===currentUser?.id&&<span className="text-[10px] text-blue-500 ml-1">(you)</span>}{u.created_by&&<span className="text-[10px] text-gray-400 ml-1">by {u.created_by}</span>}</p><p className="text-xs text-gray-500">{u.email}</p></div></div>},
    {key:'role',header:'Role',render:(u:User)=><Badge variant={u.role==='super_admin'?'danger':u.role==='admin'?'info':'default'} size="sm">{roleLabels[u.role]||u.role}</Badge>},
    {key:'permissions',header:'Permissions',render:(u:User)=><div className="flex flex-wrap gap-0.5 max-w-[200px]">{(u.permissions||[]).slice(0,3).map((p,i)=><Badge key={i} variant="default" size="sm">{p.replace(/_/g,' ')}</Badge>)}{(u.permissions||[]).length>3&&<Badge variant="default" size="sm">+{u.permissions.length-3}</Badge>}</div>},
    {key:'status',header:'Status',render:(u:User)=><Badge variant={u.is_active?'success':'danger'} dot size="sm">{u.is_active?'Active':'Blocked'}</Badge>},
    {key:'lastLogin',header:'Last Login',render:(u:User)=><span className="text-xs text-gray-500">{u.last_login?new Date(u.last_login).toLocaleString():'Never'}</span>},
    {key:'actions',header:'Actions',render:(u:User)=><div className="flex gap-0.5">
      {(isSuperAdmin || u.role !== 'super_admin') && <button onClick={()=>openEdit(u)} className="p-1 rounded hover:bg-gray-100" title="Edit"><Edit size={14} className="text-gray-500"/></button>}
      <button onClick={()=>openPermissions(u)} className="p-1 rounded hover:bg-gray-100" title="Permissions"><Settings size={14} className="text-indigo-500"/></button>
      <button onClick={()=>{if(!isSuperAdmin&&u.role==='super_admin'){alert('Not allowed');return;}setPwdTarget(u);setNewPwd('');setShowPwdModal(true);}} className="p-1 rounded hover:bg-gray-100" title="Reset Password"><Shield size={14} className="text-yellow-500"/></button>
      {(isSuperAdmin || u.role !== 'super_admin') && <button onClick={()=>handleBlockUser(u)} className={`p-1 rounded hover:bg-gray-100 ${u.is_active?'text-red-500':'text-green-500'}`} title={u.is_active?'Block':'Unblock'}>{u.is_active?<X size={14}/>:<AlertTriangle size={14}/>}</button>}
      {(isSuperAdmin || u.role !== 'super_admin') && <button onClick={()=>handleDeleteUser(u)} className="p-1 rounded hover:bg-gray-100" title="Delete"><Trash2 size={14} className="text-red-500"/></button>}
    </div>},
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">User Management</h1>
          <p className="text-gray-500 mt-1">
            {isSuperAdmin ? <span className="text-green-600 font-medium">🔒 Super Admin — Full user control</span> :
             isAdmin ? <span className="text-blue-600 font-medium">Admin — Manage non-super-admin users</span> :
             <span className="text-gray-500">View only</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<Lock size={16}/>} onClick={()=>setShowOwnPwdModal(true)}>Change My Password</Button>
          {isAdmin && <Button icon={<UserPlus size={18}/>} onClick={openAdd}>Add User</Button>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border"><p className="text-sm text-gray-500">Total Users</p><p className="text-2xl font-bold">{users.length}</p></div>
        <div className="bg-white rounded-xl p-4 border"><p className="text-sm text-gray-500">Active</p><p className="text-2xl font-bold text-green-600">{users.filter(u=>u.is_active).length}</p></div>
        <div className="bg-white rounded-xl p-4 border"><p className="text-sm text-gray-500">Blocked</p><p className="text-2xl font-bold text-red-600">{users.filter(u=>!u.is_active).length}</p></div>
        <div className="bg-white rounded-xl p-4 border"><p className="text-sm text-gray-500">Roles</p><p className="text-2xl font-bold text-purple-600">{new Set(users.map(u=>u.role)).size}</p></div>
      </div>

      <Card><div className="relative"><Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/><input type="text" placeholder="Search by username or email..." value={search} onChange={e=>setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/></div></Card>
      <Card noPadding>
        <Table columns={columns} data={paginated} keyExtractor={(u:User)=>u.id}/>
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filtered.length} itemsPerPage={itemsPerPage}/>
      </Card>

      {/* Add/Edit User Modal */}
      <Modal isOpen={showModal} onClose={()=>setShowModal(false)} title={editing?'Edit User':'Add New User'} size="lg"
        footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>setShowModal(false)}>Cancel</Button><Button onClick={handleSave}>{editing?'Update':'Create'}</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4"><Input label="Username *" value={form.username} onChange={e=>setForm(p=>({...p,username:e.target.value}))} required/><Input label="Email *" value={form.email} onChange={e=>setForm(p=>({...p,email:e.target.value}))} type="email" required/></div>
          <div className="grid grid-cols-2 gap-4">
            <Select label="Role *" value={form.role} onChange={e=>setForm(p=>({...p,role:e.target.value as User['role']}))} options={availableRoles} required/>
            <Input label={editing?'New Password (blank=keep current)':'Password *'} type="text" value={form.password} onChange={e=>setForm(p=>({...p,password:e.target.value}))} required={!editing}/>
          </div>
          <Input label="Display Name" value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} />
          <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-700">Permissions are set based on role. Use the Permissions button to customize after creation.</div>
        </div>
      </Modal>

      {/* Permissions Modal */}
      <Modal isOpen={showPermissionModal} onClose={()=>setShowPermissionModal(false)} title={`Permissions: ${permissionTarget?.username} (${roleLabels[permissionTarget?.role||'']})`} size="lg"
        footer={<div className="flex justify-between w-full">
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={()=>{const def = DEFAULT_PERMISSIONS[permissionTarget?.role||''] || [];setSelectedPerms([...def]);}}>Reset to Role Default</Button>
            <Button size="sm" variant="secondary" onClick={()=>setSelectedPerms([])}>Clear All</Button>
          </div>
          <div className="flex gap-3"><Button variant="secondary" onClick={()=>setShowPermissionModal(false)}>Cancel</Button><Button onClick={handleSavePermissions}>Save {selectedPerms.length} Permissions</Button></div>
        </div>}>
        <div className="space-y-2">
          <div className="bg-gray-50 p-3 rounded-lg mb-3"><p className="text-sm text-gray-600"><strong>Role:</strong> {roleLabels[permissionTarget?.role||'']} | <strong>Default permissions:</strong> {(DEFAULT_PERMISSIONS[permissionTarget?.role||''] || []).length} | <strong>Selected:</strong> {selectedPerms.length}</p></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {ALL_PERMISSIONS.map(perm => (
              <label key={perm.key} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${selectedPerms.includes(perm.key)?'border-blue-500 bg-blue-50':'border-gray-200 hover:border-gray-300'}`}>
                <input type="checkbox" checked={selectedPerms.includes(perm.key)} onChange={()=>togglePerm(perm.key)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 mt-0.5"/>
                <div>
                  <p className="text-sm font-medium text-gray-800">{perm.label}</p>
                  <p className="text-xs text-gray-500">{perm.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
      </Modal>

      {/* Reset Password Modal */}
      <Modal isOpen={showPwdModal} onClose={()=>{setShowPwdModal(false);setPwdTarget(null);}} title={`Reset Password: ${pwdTarget?.username}`}
        footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>{setShowPwdModal(false);setPwdTarget(null);}}>Cancel</Button><Button onClick={()=>{if(newPwd&&pwdTarget){resetPassword(pwdTarget.id,newPwd);setShowPwdModal(false);setNewPwd('');}}}>Reset</Button></div>}>
        <Input label="New Password" type="text" value={newPwd} onChange={e=>setNewPwd(e.target.value)} placeholder="Enter new password" required/>
      </Modal>

      {/* Change Own Password Modal */}
      <Modal isOpen={showOwnPwdModal} onClose={()=>{setShowOwnPwdModal(false);setOwnPwdError('');}} title="Change My Password"
        footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>{setShowOwnPwdModal(false);setOwnPwdError('');}}>Cancel</Button><Button onClick={handleChangeOwnPassword}>Change Password</Button></div>}>
        <div className="space-y-4">
          {ownPwdError && <div className="flex items-center gap-2 text-sm text-red-600"><AlertTriangle size={16}/> {ownPwdError}</div>}
          <Input label="Current Password" type="password" value={ownCurrentPwd} onChange={e=>setOwnCurrentPwd(e.target.value)} placeholder="Enter current password" required/>
          <Input label="New Password" type="text" value={ownNewPwd} onChange={e=>setOwnNewPwd(e.target.value)} placeholder="Enter new password (min 4 chars)" required/>
        </div>
      </Modal>
    </div>
  );
};
