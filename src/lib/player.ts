import { useCallback, useEffect, useState } from "react";

/**
 * Players don't have accounts. Each device gets a random player id (kept in
 * localStorage) plus the name they last used, so "My sessions" works without login.
 */
export type PlayerProfile = { playerId: string; name: string; usesMultisport: boolean; cardNumber: string; holderName: string };

const KEY = "friends-club.player";

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function loadPlayer(): PlayerProfile {
  let stored: Partial<PlayerProfile> = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    /* storage unavailable */
  }
  const profile: PlayerProfile = {
    playerId: stored.playerId || newId(),
    name: stored.name || "",
    usesMultisport: stored.usesMultisport ?? true,
    cardNumber: stored.cardNumber || "",
    holderName: stored.holderName || "",
  };
  if (!stored.playerId) savePlayer(profile);
  return profile;
}

export function savePlayer(profile: PlayerProfile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event("friends-club:player"));
}

export function usePlayer() {
  const [player, setPlayer] = useState<PlayerProfile>(() => loadPlayer());
  useEffect(() => {
    const sync = () => setPlayer(loadPlayer());
    window.addEventListener("friends-club:player", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("friends-club:player", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const update = useCallback((patch: Partial<PlayerProfile>) => {
    const next = { ...loadPlayer(), ...patch };
    savePlayer(next);
    setPlayer(next);
  }, []);
  return [player, update] as const;
}
