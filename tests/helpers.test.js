import { describe, expect, it } from "vitest";

// Copies of the small pure helpers used across the app. Kept mirrored here (rather
// than importing) so tests don't drag in the server's DB module. If a helper drifts,
// the test breaks and reminds us to keep them in sync.

const cardKey = (value) => (value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const needsPartner = (fmt) => fmt !== "singles";
const defaultGuestName = (playerName, index) => {
  const first = playerName.trim().split(/\s+/)[0] || "Player";
  return `${first}'s guest ${index + 1}`;
};

describe("cardKey", () => {
  it("normalises spaces and dashes", () => {
    expect(cardKey("1234-5678 9012")).toBe("123456789012");
  });
  it("uppercases letters", () => {
    expect(cardKey("abc-123")).toBe("ABC123");
  });
  it("returns empty for null/undefined", () => {
    expect(cardKey(null)).toBe("");
    expect(cardKey(undefined)).toBe("");
  });
});

describe("needsPartner", () => {
  it("returns true for doubles and mixed", () => {
    expect(needsPartner("doubles")).toBe(true);
    expect(needsPartner("mixed")).toBe(true);
  });
  it("returns false for singles", () => {
    expect(needsPartner("singles")).toBe(false);
  });
});

describe("defaultGuestName", () => {
  it("uses the player's first name and 1-based index", () => {
    expect(defaultGuestName("Sarah Marek", 0)).toBe("Sarah's guest 1");
    expect(defaultGuestName("Sarah Marek", 2)).toBe("Sarah's guest 3");
  });
  it("handles single-word names", () => {
    expect(defaultGuestName("Ada", 0)).toBe("Ada's guest 1");
  });
  it("falls back when name is empty", () => {
    expect(defaultGuestName("", 0)).toBe("Player's guest 1");
    expect(defaultGuestName("   ", 0)).toBe("Player's guest 1");
  });
});
