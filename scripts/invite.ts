import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

const USAGE = `Usage: pnpm invite [--remote] [--uses 1] [--days 7]
       pnpm invite [--remote] --list

Creates an invite code and prints its link, or lists all codes.
--remote writes to the production database; without it, to the local one.
Set PUBLIC_URL to print full links for --remote.`;

const { values } = parseArgs({
  options: {
    days: { default: "7", type: "string" },
    help: { default: false, type: "boolean" },
    list: { default: false, type: "boolean" },
    remote: { default: false, type: "boolean" },
    uses: { default: "1", type: "string" },
  },
});

interface InviteRow {
  code: string;
  expiresAt: number;
  maxUses: number;
  uses: number;
}

const d1 = (sql: string): InviteRow[] => {
  const output = execFileSync(
    "wrangler",
    [
      "d1",
      "execute",
      "DB",
      values.remote ? "--remote" : "--local",
      "--json",
      "--command",
      sql,
    ],
    { encoding: "utf-8", stdio: ["ignore", "pipe", "inherit"] }
  );
  return JSON.parse(output)[0].results;
};

const positiveInteger = (name: string, value: string) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    console.error(`--${name} must be a whole number of 1 or more.`);
    process.exit(1);
  }
  return number;
};

// 32 letters and digits without 0, O, 1, and I, which are easy to misread.
// 256 is a multiple of 32, so `byte % 32` picks each one equally often.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

const newCode = () =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(8)),
    (byte) => ALPHABET[byte % ALPHABET.length]
  ).join("");

const display = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

const baseUrl =
  process.env["PUBLIC_URL"] ?? (values.remote ? "" : "http://localhost:5173");

const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const stateOf = (row: InviteRow) => {
  if (row.uses >= row.maxUses) {
    return "used up";
  }
  return row.expiresAt <= Date.now() ? "expired" : "usable";
};

if (values.help) {
  console.log(USAGE);
} else if (values.list) {
  const rows = d1(
    'SELECT "code", "uses", "maxUses", "expiresAt" FROM "inviteCode" ORDER BY "createdAt" DESC'
  );
  for (const row of rows) {
    console.log(
      `${display(row.code)}  ${row.uses}/${row.maxUses} used  expires ${date(row.expiresAt)}  ${stateOf(row)}`
    );
  }
  if (rows.length === 0) {
    console.log("No invite codes yet.");
  }
} else {
  const uses = positiveInteger("uses", values.uses);
  const days = positiveInteger("days", values.days);
  const code = newCode();
  const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
  d1(
    `INSERT INTO "inviteCode" ("code", "maxUses", "expiresAt") VALUES ('${code}', ${uses}, ${expiresAt})`
  );
  console.log(`${baseUrl}/join/${display(code)}`);
  console.log(
    `${uses} ${uses === 1 ? "use" : "uses"}, expires ${date(expiresAt)}`
  );
}
