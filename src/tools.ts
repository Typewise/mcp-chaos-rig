import { z } from "zod";
import type { ServerState, ToolVersion } from "./state.js";
import { slowModeDelay } from "./state.js";
import { listContacts, searchContacts, createContact, deleteContact, updateContactField } from "./db.js";

interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}


const echoV1: ToolDef = {
  name: "echo",
  title: "Echo Message",
  description: "Echoes back the provided message verbatim as plain text.",
  inputSchema: {
    message: z.string().describe("The message to echo back."),
  },
  handler: async (args) => { await slowModeDelay(); return textResult(String(args.message)); },
};

const echoV2: ToolDef = {
  name: "echo",
  title: "Echo Message (Formatted)",
  description:
    "Echoes back the provided message in the chosen format: 'plain' returns it unchanged, " +
    "'json' wraps it as {\"echo\": \"...\"}, 'uppercase' converts to uppercase.",
  inputSchema: {
    message: z.string().describe("The message to echo back."),
    format: z.enum(["plain", "json", "uppercase"]).describe(
      "Output format: 'plain', 'json', or 'uppercase'."
    ),
  },
  handler: async (args) => {
    await slowModeDelay();
    const msg = String(args.message);
    const fmt = String(args.format);
    if (fmt === "json") return textResult(JSON.stringify({ echo: msg }));
    if (fmt === "uppercase") return textResult(msg.toUpperCase());
    return textResult(msg);
  },
};

const addV1: ToolDef = {
  name: "add",
  title: "Add Two Numbers",
  description: "Returns the sum of two numbers.",
  inputSchema: {
    a: z.number().describe("First number."),
    b: z.number().describe("Second number."),
  },
  handler: async (args) => { await slowModeDelay(); return textResult(String(Number(args.a) + Number(args.b))); },
};

const addV2: ToolDef = {
  name: "add",
  title: "Sum Number Array",
  description: "Returns the sum of an array of numbers. An empty array returns 0.",
  inputSchema: {
    numbers: z.array(z.number()).describe("Numbers to sum."),
  },
  handler: async (args) => {
    await slowModeDelay();
    const nums = args.numbers as number[];
    return textResult(String(nums.reduce((s, n) => s + n, 0)));
  },
};

const getTime: ToolDef = {
  name: "get-time",
  title: "Get Current Time",
  description: "Returns the current server time as an ISO 8601 string (e.g. '2025-01-30T14:30:00.000Z').",
  inputSchema: {},
  handler: async () => { await slowModeDelay(); return textResult(new Date().toISOString()); },
};

const randomNumber: ToolDef = {
  name: "random-number",
  title: "Generate Random Number",
  description:
    "Generates a cryptographically non-secure pseudo-random integer within the specified " +
    "inclusive range [min, max]. Both bounds must be integers. The result is uniformly " +
    "distributed across all integers from min to max, inclusive of both endpoints. For " +
    "example, with min=1 and max=6, this simulates a standard six-sided die roll. The " +
    "random number is generated using Math.random() and Math.floor(), which is suitable " +
    "for testing purposes but should not be used for security-sensitive applications. " +
    "This tool is useful for testing MCP tool calls with integer-typed parameters and " +
    "for verifying that the client correctly validates integer constraints. If min equals " +
    "max, the result is always that value. If min is greater than max, the behavior is " +
    "undefined (may return values outside the expected range).",
  inputSchema: {
    min: z.number().int().describe(
      "The lower bound of the random range (inclusive). Must be an integer. " +
      "For example, 1 for a standard die roll."
    ),
    max: z.number().int().describe(
      "The upper bound of the random range (inclusive). Must be an integer. " +
      "Should be greater than or equal to min. For example, 6 for a standard die roll."
    ),
  },
  handler: async (args) => {
    await slowModeDelay();
    const min = Number(args.min);
    const max = Number(args.max);
    const result = Math.floor(Math.random() * (max - min + 1)) + min;
    return textResult(String(result));
  },
};

const reverse: ToolDef = {
  name: "reverse",
  title: "Reverse String",
  description:
    "Reverses the characters in the provided input string and returns the result. This tool " +
    "performs a simple Unicode-aware string reversal by splitting the input into an array of " +
    "characters, reversing their order, and joining them back into a string. For example, " +
    "'hello' becomes 'olleh' and 'abcdef' becomes 'fedcba'. This tool is useful for testing " +
    "MCP tool invocations where the output is deterministically derived from the input, making " +
    "it easy to verify correct behavior in automated tests. Unlike echo, the output is always " +
    "different from the input (unless the string is a palindrome), which makes it straightforward " +
    "to confirm that the tool actually executed rather than the client returning a cached or " +
    "passthrough result. Empty strings return an empty string. Multi-byte Unicode characters " +
    "such as emoji are handled correctly via Array.from() which splits on code points rather " +
    "than UTF-16 code units.",
  inputSchema: {
    text: z.string().describe(
      "The string to reverse. Can contain any valid UTF-8 text including whitespace, " +
      "newlines, special characters, emoji, and multi-byte Unicode sequences. The reversal " +
      "operates on Unicode code points, so surrogate pairs are preserved."
    ),
  },
  handler: async (args) => {
    await slowModeDelay();
    return textResult(Array.from(String(args.text)).reverse().join(""));
  },
};

const versionedTools: Record<string, Record<ToolVersion, ToolDef>> = {
  echo: { v1: echoV1, v2: echoV2 },
  add: { v1: addV1, v2: addV2 },
};

const listContactsTool: ToolDef = {
  name: "list-contacts",
  title: "List All Contacts",
  description:
    "Returns all contacts from the database as a JSON array, ordered by ID. Each contact has " +
    "id, name, email, company, notes, and created_at fields. Returns an empty array if no " +
    "contacts exist.",
  inputSchema: {},
  handler: async () => {
    await slowModeDelay();
    return textResult(JSON.stringify(listContacts(), null, 2));
  },
};

const searchContactsTool: ToolDef = {
  name: "search-contacts",
  title: "Search Contacts",
  description:
    "Searches contacts by a query string. Case-insensitive substring match against name, " +
    "email, company, and notes fields. Returns a JSON array of matching contacts, or an " +
    "empty array if none match.",
  inputSchema: {
    query: z.string().describe("Search term to match against name, email, company, and notes."),
  },
  handler: async (args) => {
    await slowModeDelay();
    return textResult(JSON.stringify(searchContacts(String(args.query)), null, 2));
  },
};

const createContactTool: ToolDef = {
  name: "create-contact",
  title: "Create Contact",
  description:
    "Creates a new contact and returns the created record with its auto-generated ID and " +
    "timestamp. Requires name and email. Company and notes are optional.",
  inputSchema: {
    name: z.string().describe("Full name, e.g. 'Jane Doe'."),
    email: z.string().describe("Email address, e.g. 'jane@example.com'."),
    company: z.string().optional().describe("Company name. Optional."),
    notes: z.string().optional().describe("Free-text notes. Optional."),
  },
  handler: async (args) => {
    await slowModeDelay();
    const contact = createContact(
      String(args.name),
      String(args.email),
      String(args.company ?? ""),
      String(args.notes ?? ""),
    );
    return textResult(JSON.stringify(contact, null, 2));
  },
};

const updateContactTool: ToolDef = {
  name: "update-contact",
  title: "Update Contact",
  description:
    "Updates a single field on a contact. Specify the contact ID, which field to change " +
    "(name, email, company, or notes), and the new value. Returns the full updated contact. " +
    "To update multiple fields, call this tool once per field.",
  inputSchema: {
    id: z.number().int().describe("The ID of the contact to update."),
    field: z.enum(["name", "email", "company", "notes"]).describe("Which field to update."),
    value: z.string().describe("The new value for the field."),
  },
  handler: async (args) => {
    await slowModeDelay();
    const updated = updateContactField(
      Number(args.id),
      String(args.field) as "name" | "email" | "company" | "notes",
      String(args.value),
    );
    if (!updated) return textResult(`Error: no contact with id ${args.id}`);
    return textResult(JSON.stringify(updated, null, 2));
  },
};

const deleteContactTool: ToolDef = {
  name: "delete-contact",
  title: "Delete Contact",
  description:
    "Permanently deletes a contact by ID. Returns a confirmation message or an error if " +
    "the ID doesn't exist. This cannot be undone.",
  inputSchema: {
    id: z.number().int().describe("The ID of the contact to delete."),
  },
  handler: async (args) => {
    await slowModeDelay();
    const deleted = deleteContact(Number(args.id));
    if (!deleted) return textResult(`Error: no contact with id ${args.id}`);
    return textResult(`Deleted contact ${args.id}`);
  },
};

const staticTools: Record<string, ToolDef> = {
  "get-time": getTime,
  "random-number": randomNumber,
  "reverse": reverse,
  "list-contacts": listContactsTool,
  "search-contacts": searchContactsTool,
  "create-contact": createContactTool,
  "update-contact": updateContactTool,
  "delete-contact": deleteContactTool,
};

export function getToolDef(name: string, version?: ToolVersion): ToolDef | undefined {
  if (name in versionedTools) {
    return versionedTools[name][version || "v1"];
  }
  return staticTools[name];
}

export function getAllToolNames(): string[] {
  return [...Object.keys(versionedTools), ...Object.keys(staticTools)];
}

export function getActiveTools(state: ServerState): ToolDef[] {
  const tools: ToolDef[] = [];
  for (const name of getAllToolNames()) {
    if (!state.enabledTools[name]) continue;
    const version = state.toolVersions[name] as ToolVersion | undefined;
    const def = getToolDef(name, version);
    if (def) tools.push(def);
  }
  return tools;
}

export function hasVersions(name: string): boolean {
  return name in versionedTools;
}

export type { ToolDef };
