import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth, useClerk } from "@clerk/react";
import { api, type Player } from "./api";

type PlayerState = {
  player: Player | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setPlayer: (p: Player | null) => void;
  logout: () => Promise<void>;
};

const PlayerContext = createContext<PlayerState | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!isSignedIn) {
      setPlayer(null);
      setLoading(false);
      return;
    }
    try {
      const { player } = await api<{ player: Player | null }>("/api/me");
      setPlayer(player);
    } catch {
      setPlayer(null);
    } finally {
      setLoading(false);
    }
  }, [isSignedIn]);

  const logout = useCallback(async () => {
    setPlayer(null);
    await signOut();
  }, [signOut]);

  useEffect(() => {
    if (!isLoaded) return;
    refresh();
  }, [isLoaded, refresh]);

  return createElement(PlayerContext.Provider, { value: { player, loading, refresh, setPlayer, logout } }, children);
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}

