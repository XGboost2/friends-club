import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type Admin } from "./api";

type AdminState = {
  admin: Admin | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setAdmin: (a: Admin | null) => void;
  logout: () => Promise<void>;
};

const AdminContext = createContext<AdminState | null>(null);

export function AdminProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const { admin } = await api<{ admin: Admin | null }>("/api/admin/me");
      setAdmin(admin);
    } catch {
      setAdmin(null);
    } finally {
      setLoading(false);
    }
  }, []);
  const logout = useCallback(async () => {
    await api("/api/admin/logout", { method: "POST" }).catch(() => {});
    setAdmin(null);
    window.location.assign("/admin/login");
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return createElement(AdminContext.Provider, { value: { admin, loading, refresh, setAdmin, logout } }, children);
}

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used inside AdminProvider");
  return ctx;
}
