import { Client } from "pg";
import { google } from "googleapis";

function mustGetEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function parseSheetId(sheetUrlOrId) {
  if (sheetUrlOrId.includes("/spreadsheets/d/")) {
    const m = sheetUrlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!m) throw new Error("Could not parse spreadsheetId from URL.");
    return m[1];
  }
  return sheetUrlOrId;
}

async function getSheetsClient() {
  const saJson = mustGetEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
  let creds;
  try {
    creds = JSON.parse(saJson);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }

  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

async function main() {
  const DATABASE_URL = mustGetEnv("DATABASE_URL");
  const SPREADSHEET_ID = parseSheetId(mustGetEnv("GOOGLE_SHEET_ID"));
  const SHEET_NAME = process.env.GOOGLE_SHEET_TAB || "Sheet1";


  const SQL =
  process.env.EXPORT_SQL ||
  `SELECT id, seed, "questionIndex", "questionText", "answerText", "employeeInfo", "createdAt"
   FROM "Answer"
   ORDER BY "createdAt" DESC;`;

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  const res = await client.query(SQL);
  await client.end();

  const columns = res.fields.map((f) => f.name);
  const rows = res.rows.map((r) => columns.map((c) => r[c]));

  const sheets = await getSheetsClient();

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:ZZ`,
  });

  const values = [columns, ...rows];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: "RAW",
    requestBody: { values },
  });

  console.log(`Exported ${rows.length} rows to ${SHEET_NAME}`);
}

main().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});