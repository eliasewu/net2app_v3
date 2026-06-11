import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface User {
  id: string; username: string; email: string;
  role: 'super_admin' | 'admin' | 'support' | 'billing' | 'agent' | 'client' | 'supplier';
  permissions: string[]; client_id?: string; supplier_id?: string;
  name?: string; is_active: boolean; last_login?: string;
  created_by?: string;
}

interface AuthContextType {
  user: User | null; isAuthenticated: boolean; isLoading: boolean;
  login: (u: string, p: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  hasPermission: (p: string) => boolean;
  isSuperAdmin: () => boolean;
  isAdmin: () => boolean;
  // User management (role-gated)
  users: User[];
  getVisibleUsers: () => User[];
  addUser: (u: Omit<User, 'id' | 'is_active' | 'last_login' | 'created_by'>, password: string) => void;
  updateUser: (id: string, data: Partial<User>) => void;
  deleteUser: (id: string) => void;
  toggleUserBlock: (id: string) => void;
  resetPassword: (id: string, newPassword: string) => void;
  changeOwnPassword: (currentPassword: string, newPassword: string) => boolean;
  // Super admin re-auth for license changes
  verifySuperAdmin: (password: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface UserRecord extends User { password: string; }
const INITIAL_USERS: UserRecord[] = [
  { id:'1', username:'admin', password:'admin123', email:'admin@net2app.com', role:'super_admin', permissions:['all'], name:'Super Admin', is_active:true, created_by:'system' },
  { id:'2', username:'support', password:'support123', email:'support@net2app.com', role:'support', permissions:['view_clients','view_suppliers','view_sms_logs','test_sms','manage_bind','view_reports'], name:'Support Team', is_active:true, created_by:'admin' },
  { id:'3', username:'billing', password:'billing123', email:'billing@net2app.com', role:'billing', permissions:['manage_invoices','manage_payments','view_reports','view_clients','view_suppliers'], name:'Billing Team', is_active:true, created_by:'admin' },
  { id:'4', username:'techcorp_user', password:'techcorp123', email:'user@techcorp.com', role:'client', client_id:'1', permissions:['view_own_cdr','view_own_usage','view_own_payments','test_sms','send_sms'], name:'TechCorp Client', is_active:true, created_by:'admin' },
  { id:'5', username:'globalsms_user', password:'globalsms123', email:'user@globalsms.com', role:'supplier', supplier_id:'1', permissions:['view_own_cdr','view_own_usage','view_own_payments','view_bind_status'], name:'GlobalSMS Supplier', is_active:true, created_by:'admin' },
];

function loadUsers(): UserRecord[] { try { const s=localStorage.getItem('pg_users_db');if(s){const p=JSON.parse(s);if(Array.isArray(p)&&p.length>0)return p;}}catch{} localStorage.setItem('pg_users_db',JSON.stringify(INITIAL_USERS));return INITIAL_USERS; }
function loadPasswords(): Record<string,string> { try { const s=localStorage.getItem('pg_passwords_db');if(s){const p=JSON.parse(s);if(Object.keys(p).length>0)return p;}}catch{} const pwd:Record<string,string>={};INITIAL_USERS.forEach(u=>{pwd[u.username]=u.password;});localStorage.setItem('pg_passwords_db',JSON.stringify(pwd));return pwd; }
function saveUsers(u: UserRecord[]) { localStorage.setItem('pg_users_db',JSON.stringify(u)); }
function savePasswords(p: Record<string,string>) { localStorage.setItem('pg_passwords_db',JSON.stringify(p)); }

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [usersDb, setUsersDb] = useState<UserRecord[]>(loadUsers);
  const [passwordsDb, setPasswordsDb] = useState<Record<string,string>>(loadPasswords);

  useEffect(() => { const sid=localStorage.getItem('auth_user_id');if(sid){const f=usersDb.find(u=>u.id===sid);if(f&&f.is_active){const{password,...s}=f;setUser(s);}else{localStorage.removeItem('auth_user_id');localStorage.removeItem('auth_token');}} setIsLoading(false); },[]);

  const login=async(username:string,password:string):Promise<{success:boolean;error?:string}>=>{await new Promise(r=>setTimeout(r,400));const f=usersDb.find(u=>u.username===username);if(!f)return{success:false,error:'Invalid username'};if(!f.is_active)return{success:false,error:'Account blocked'};if((passwordsDb[username]||f.password)!==password)return{success:false,error:'Invalid password'};const{password:_,...s}=f;localStorage.setItem('auth_token','tok_'+Date.now());localStorage.setItem('auth_user_id',f.id);setUser(s);return{success:true};};
  const logout=()=>{localStorage.removeItem('auth_token');localStorage.removeItem('auth_user_id');setUser(null);window.location.href='/login';};
  const hasPermission=(p:string)=>{if(!user)return false;if(user.role==='super_admin'||user.permissions.includes('all'))return true;return user.permissions.includes(p);};
  const isSuperAdmin=()=>user?.role==='super_admin';
  const isAdmin=()=>user?.role==='super_admin'||user?.role==='admin';

  // Admin can add support/billing/agent/client/supplier but NOT super_admin
  const addUser=(nu:Omit<User,'id'|'is_active'|'last_login'|'created_by'>,pw:string)=>{
    if(!user)return;
    // Admins cannot create super_admin accounts
    if(user.role==='admin'&&nu.role==='super_admin'){alert('Only Super Admin can create Super Admin accounts');return;}
    const id=String(Date.now());const r:UserRecord={...nu,id,is_active:true,password:pw,created_by:user.username};
    const up=[...usersDb,r];setUsersDb(up);saveUsers(up);
    setPasswordsDb(prev=>{const n={...prev,[nu.username]:pw};savePasswords(n);return n;});
  };

  const updateUser=(id:string,data:Partial<User>)=>{
    const target=usersDb.find(u=>u.id===id);
    // Admin cannot modify super_admin users
    if(user&&user.role==='admin'&&target?.role==='super_admin'){alert('Admin cannot modify Super Admin users');return;}
    // Admin cannot upgrade anyone to super_admin
    if(user&&user.role==='admin'&&data.role==='super_admin'){alert('Only Super Admin can grant super_admin role');return;}
    // Admin cannot change their own role
    if(user&&user.role==='admin'&&id===user.id&&data.role&&data.role!=='admin'){alert('You cannot change your own role');return;}
    const up=usersDb.map(u=>u.id===id?{...u,...data}:u);setUsersDb(up);saveUsers(up);
    if(user&&user.id===id){const f=up.find(u=>u.id===id);if(f){const{password,...s}=f;setUser(s);}}
  };

  const deleteUser=(id:string)=>{
    const target=usersDb.find(u=>u.id===id);
    if(user&&user.role==='admin'&&target?.role==='super_admin'){alert('Admin cannot delete Super Admin users');return;}
    const up=usersDb.filter(u=>u.id!==id);setUsersDb(up);saveUsers(up);
    if(target){setPasswordsDb(prev=>{const n={...prev};delete n[target.username];savePasswords(n);return n;});}
  };

  const toggleUserBlock=(id:string)=>{
    const target=usersDb.find(u=>u.id===id);
    if(user&&user.role==='admin'&&target?.role==='super_admin'){alert('Admin cannot block Super Admin users');return;}
    const up=usersDb.map(u=>u.id===id?{...u,is_active:!u.is_active}:u);setUsersDb(up);saveUsers(up);
  };

  const resetPassword=(id:string,np:string)=>{
    const target=usersDb.find(u=>u.id===id);
    if(user&&user.role==='admin'&&target?.role==='super_admin'){alert('Admin cannot reset Super Admin password');return;}
    const f=usersDb.find(u=>u.id===id);
    if(f){setPasswordsDb(prev=>{const n={...prev,[f.username]:np};savePasswords(n);return n;});}
  };

  // Super admin can change own password (requires current password)
  const changeOwnPassword=(currentPassword:string,newPassword:string):boolean=>{
    if(!user)return false;
    const currentPwd=passwordsDb[user.username];
    if(currentPwd!==currentPassword)return false;
    setPasswordsDb(prev=>{const n={...prev,[user.username]:newPassword};savePasswords(n);return n;});
    return true;
  };

  // License changes require super admin password re-verification
  const verifySuperAdmin=(password:string):boolean=>{
    if(!user||user.role!=='super_admin')return false;
    const stored=passwordsDb[user.username];
    return stored===password;
  };

  // Filter out super_admin users from admin view
  const getVisibleUsers=():User[]=>{
    const all:User[]=usersDb.map(({password,...u})=>u);
    if(user?.role==='admin'){return all.filter(u=>u.role!=='super_admin');}
    return all;
  };

  const users:User[]=usersDb.map(({password,...u})=>u);

  return (<AuthContext.Provider value={{user,isAuthenticated:!!user,isLoading,login,logout,hasPermission,isSuperAdmin,isAdmin,users,getVisibleUsers,addUser,updateUser,deleteUser,toggleUserBlock,resetPassword,changeOwnPassword,verifySuperAdmin}}>{children}</AuthContext.Provider>);
};

export const useAuth=()=>{const c=useContext(AuthContext);if(!c)throw new Error('useAuth required');return c;};
