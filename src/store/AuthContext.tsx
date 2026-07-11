import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '../services/api';

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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On mount, check if there's an existing session via httpOnly cookie
  useEffect(() => {
    const checkSession = async () => {
      try {
        const res: any = await api.get('/auth/me');
        if (res.success && res.data?.data) {
          const serverUser = res.data.data;
          setUser({
            id: String(serverUser.id),
            username: serverUser.username,
            email: serverUser.email || '',
            role: serverUser.role,
            permissions: serverUser.permissions || [],
            client_id: serverUser.client_id ? String(serverUser.client_id) : undefined,
            supplier_id: serverUser.supplier_id ? String(serverUser.supplier_id) : undefined,
            name: serverUser.name || serverUser.username,
            is_active: serverUser.is_active ?? true,
          });
        }
      } catch {
        // No valid session — user will need to log in
      }
      setIsLoading(false);
    };
    checkSession();
  }, []);

  const login = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res: any = await api.post('/auth/login', { username, password });
      if (!res.success) {
        return { success: false, error: res.error || res.data?.error || 'Invalid credentials' };
      }
      // Token is now set as httpOnly cookie by the server — no manual token handling needed
      const serverUser = res.data.user;
      const appUser: User = {
        id: String(serverUser.id),
        username: serverUser.username,
        email: serverUser.email || '',
        role: serverUser.role,
        permissions: serverUser.permissions || [],
        client_id: serverUser.client_id ? String(serverUser.client_id) : undefined,
        supplier_id: serverUser.supplier_id ? String(serverUser.supplier_id) : undefined,
        name: serverUser.name || serverUser.username,
        is_active: true,
      };
      setUser(appUser);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Login failed' };
    }
  };
  const logout = async () => {
    try {
      await api.post('/auth/logout', {});
    } catch { /* ignore */ }
    setUser(null);
    window.location.href = '/login';
  };
  const hasPermission=(p:string)=>{if(!user)return false;if(user.role==='super_admin'||user.permissions.includes('all'))return true;return user.permissions.includes(p);};
  const isSuperAdmin=()=>user?.role==='super_admin';
  const isAdmin=()=>user?.role==='super_admin'||user?.role==='admin';

  return (<AuthContext.Provider value={{user,isAuthenticated:!!user,isLoading,login,logout,hasPermission,isSuperAdmin,isAdmin}}>{children}</AuthContext.Provider>);
};

export const useAuth=()=>{const c=useContext(AuthContext);if(!c)throw new Error('useAuth required');return c;};
