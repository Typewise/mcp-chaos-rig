import Database from "better-sqlite3";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data.db");

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    company TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const count = db.prepare("SELECT COUNT(*) as n FROM contacts").get() as { n: number };
if (count.n === 0) {
  const insert = db.prepare("INSERT INTO contacts (name, email, company, notes) VALUES (?, ?, ?, ?)");
  insert.run("Alice Johnson", "alice@acme.com", "Acme Corp", "Key account, prefers email");
  insert.run("Bob Smith", "bob@globex.com", "Globex Inc", "Referred by Alice");
  insert.run("Carol White", "carol@initech.com", "Initech", "Interested in enterprise plan");
}

export interface Contact {
  id: number;
  name: string;
  email: string;
  company: string;
  notes: string;
  created_at: string;
}

export function listContacts(): Contact[] {
  return db.prepare("SELECT * FROM contacts ORDER BY id").all() as Contact[];
}

export function searchContacts(query: string): Contact[] {
  const pattern = `%${query}%`;
  return db.prepare(
    "SELECT * FROM contacts WHERE name LIKE ? OR email LIKE ? OR company LIKE ? OR notes LIKE ? ORDER BY id"
  ).all(pattern, pattern, pattern, pattern) as Contact[];
}

export function createContact(name: string, email: string, company: string, notes: string): Contact {
  const result = db.prepare(
    "INSERT INTO contacts (name, email, company, notes) VALUES (?, ?, ?, ?)"
  ).run(name, email, company, notes);
  return db.prepare("SELECT * FROM contacts WHERE id = ?").get(result.lastInsertRowid) as Contact;
}

export function deleteContact(id: number): boolean {
  const result = db.prepare("DELETE FROM contacts WHERE id = ?").run(id);
  return result.changes > 0;
}

export function updateContactField(id: number, field: "name" | "email" | "company" | "notes", value: string): Contact | null {
  const existing = db.prepare("SELECT * FROM contacts WHERE id = ?").get(id) as Contact | undefined;
  if (!existing) return null;
  db.prepare(`UPDATE contacts SET ${field} = ? WHERE id = ?`).run(value, id);
  return db.prepare("SELECT * FROM contacts WHERE id = ?").get(id) as Contact;
}

export function resetDatabase(): void {
  db.exec("DELETE FROM contacts");
  db.exec("DELETE FROM sqlite_sequence WHERE name = 'contacts'");
  const insert = db.prepare("INSERT INTO contacts (name, email, company, notes) VALUES (?, ?, ?, ?)");
  insert.run("Alice Johnson", "alice@acme.com", "Acme Corp", "Key account, prefers email");
  insert.run("Bob Smith", "bob@globex.com", "Globex Inc", "Referred by Alice");
  insert.run("Carol White", "carol@initech.com", "Initech", "Interested in enterprise plan");
}
