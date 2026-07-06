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

  useEffect(() => {
    const storedToken = localStorage.getItem('auth_token');
    const storedUser = localStorage.getItem('auth_user');
    if (storedToken && storedUser) {
      try {
        api.setToken(storedToken);
        setUser(JSON.parse(storedUser));
      } catch {}
    }
    setIsLoading(false);
  }, []);

  const login = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res: any = await api.post('/auth/login', { username, password });
      if (!res.success || !res.data?.token) {
        return { success: false, error: res.error || res.data?.error || 'Invalid credentials' };
      }
      const { token, user: serverUser } = res.data;
      api.setToken(token);
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
      localStorage.setItem('auth_user', JSON.stringify(appUser));
      setUser(appUser);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Login failed' };
    }
  };
  const logout = () => {
    api.setToken(null);
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setUser(null);
    window.location.href = '/login';
  };
  const hasPermission=(p:string)=>{if(!user)return false;if(user.role==='super_admin'||user.permissions.includes('all'))return true;return user.permissions.includes(p);};
  const isSuperAdmin=()=>user?.role==='super_admin';
  const isAdmin=()=>user?.role==='super_admin'||user?.role==='admin';

  return (<AuthContext.Provider value={{user,isAuthenticated:!!user,isLoading,login,logout,hasPermission,isSuperAdmin,isAdmin}}>{children}</AuthContext.Provider>);
};

export const useAuth=()=>{const c=useContext(AuthContext);if(!c)throw new Error('useAuth required');return c;};
