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
    try { localStorage.removeItem(CARD_KEY); } catch { /* ignore */ }
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

// Card details stay per-device (payment convenience, not identity).
export type CardPrefs = { usesMultisport: boolean; cardNumber: string; holderName: string };
const CARD_KEY = "friends-club.card";

export function loadCardPrefs(): CardPrefs {
  try {
    const stored = JSON.parse(localStorage.getItem(CARD_KEY) || "{}") as Partial<CardPrefs>;
    return {
      usesMultisport: stored.usesMultisport ?? true,
      cardNumber: stored.cardNumber || "",
      holderName: stored.holderName || "",
    };
  } catch {
    return { usesMultisport: true, cardNumber: "", holderName: "" };
  }
}

export function saveCardPrefs(prefs: CardPrefs) {
  try {
    localStorage.setItem(CARD_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}
