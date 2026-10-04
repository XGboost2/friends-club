export type Session = {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  venue: string;
  capacity: number;
  courtsCount: number;
  courtNumbers: string | null;
  notes: string | null;
  status: "open" | "closed";
  playerCount: number;
  guestCount: number;
  total: number;
  players: string[];
  multisportCount?: number;
  me?: { multisport: boolean; status: "pending" | "paid"; guests: string[]; isMine: boolean; canLeave: boolean } | null;
};

export type Guest = {
  id: number;
  name: string;
  status: "pending" | "paid";
  multisport: boolean;
  cardNumber: string | null;
  holderName: string | null;
  paidMethod: "scan" | "manual" | null;
};
export type Registration = {
  id: number;
  name: string;
  multisport: boolean;
  cardNumber: string | null;
  holderName: string | null;
  status: "pending" | "paid";
  paidAt: string | null;
  paidMethod: "scan" | "manual" | null;
  guests: Guest[];
  createdAt: string;
};
export type SessionDetail = Session & { registrations: Registration[] };
export type Admin = { id: number; email: string; approved: boolean; created_at?: string };

export type PlayerLevel = "beginner" | "intermediate" | "advanced";
export type Player = {
  id: number;
  email: string;
  phone: string | null;
  name: string;
  level: PlayerLevel | null;
  blocked: boolean;
  createdAt?: string;
};
export type AdminPlayer = Player & { sessionCount: number; lastActive: string | null };

export type TournamentFormat = "mens_singles" | "womens_singles" | "mens_doubles" | "womens_doubles" | "mixed";
export type TournamentStructure = "group" | "ko" | "group_ko";
export type TournamentMatchStage = "group" | "r32" | "r16" | "quarter" | "semi" | "final";
export type TournamentMatchStatus = "pending" | "reported" | "confirmed";
export type TournamentStatus = "draft" | "open" | "closed" | "completed";
export type TournamentCategory = {
  id: number;
  format: TournamentFormat;
  level: PlayerLevel;
  isOpen: boolean;
  maxEntries: number | null;
  entryCount: number;
  structure: TournamentStructure;
  groupSize: number;
  advanceCount: number;
  hasFixtures?: boolean;
};

export type TournamentMatch = {
  id: number;
  categoryId: number;
  stage: TournamentMatchStage;
  groupId: number | null;
  groupName: string | null;
  roundNumber: number | null;
  slot: number | null;
  entryA: { id: number; playerName: string; partnerName: string | null } | null;
  entryB: { id: number; playerName: string; partnerName: string | null } | null;
  winnerEntryId: number | null;
  set1: [number, number] | null;
  set2: [number, number] | null;
  set3: [number, number] | null;
  court: string | null;
  scheduledAt: string | null;
  status: TournamentMatchStatus;
  reportedBy: number | null;
  reportedAt: string | null;
  confirmedAt: string | null;
};

export type TournamentGroup = {
  id: number;
  name: string;
  position: number;
  entries: {
    registrationId: number;
    playerName: string;
    partnerName: string | null;
    played: number;
    wins: number;
    losses: number;
    setsWon: number;
    setsLost: number;
    pointsFor: number;
    pointsAgainst: number;
    rank: number;
    qualifying: "qualified" | "eliminated" | "in-contention";
  }[];
};

export type TournamentSchedule = {
  category: TournamentCategory;
  groups: TournamentGroup[];
  matches: TournamentMatch[];
};
export type Tournament = {
  id: number;
  name: string;
  startsOn: string;
  startTime: string | null;
  venue: string;
  description: string | null;
  status: TournamentStatus;
  createdAt?: string;
  entryCount?: number;
};
export type TournamentDetail = Tournament & {
  categories: TournamentCategory[];
  players?: { id: number; name: string; level: PlayerLevel }[];
};
export type TournamentRegistration = {
  id: number;
  categoryId: number;
  format: TournamentFormat;
  level: PlayerLevel;
  playerId: number;
  playerName: string;
  partnerId: number | null;
  partnerName: string | null;
  partnerRegistered?: boolean;
  createdAt: string;
  imOwner?: boolean;
};

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function clerkBearer(): Promise<string | null> {
  try { return (await (window as any).Clerk?.session?.getToken?.()) ?? null; } catch { return null; }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body) headers["Content-Type"] = "application/json";
  // Player endpoints authenticate via Clerk bearer tokens. Admin endpoints still use the fc_admin cookie.
  const token = path.startsWith("/api/admin") ? null : await clerkBearer();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method ?? (options.body ? "POST" : "GET"),
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || "Something went wrong.", res.status);
  return data as T;
}
