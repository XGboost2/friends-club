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

export type Guest = { id: number; name: string; status: "pending" | "paid" };
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
  phone: string;
  name: string;
  level: PlayerLevel;
  blocked: boolean;
  createdAt?: string;
};
export type AdminPlayer = Player & { sessionCount: number; lastActive: string | null };

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method ?? (options.body ? "POST" : "GET"),
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
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
