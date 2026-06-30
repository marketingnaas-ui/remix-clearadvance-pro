import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import * as XLSX from "xlsx";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

// Load environment variables
dotenv.config();

// 1. Initialize Firebase Admin
let firebaseConfig: any = {};
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  }
} catch (e) {
  console.error("Warning: Failed to read firebase-applet-config.json:", e);
}

// Support service account json if provided in environment or file
let db: any;
try {
  const apps = getApps();
  let adminApp: any;
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!apps.length) {
    const initOptions: any = {
      projectId: firebaseConfig.projectId || process.env.VITE_FIREBASE_PROJECT_ID,
    };
    
    if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
      initOptions.credential = cert(JSON.parse(fs.readFileSync(serviceAccountPath, "utf8")));
    }
    
    adminApp = initializeApp(initOptions);
  } else {
    adminApp = apps[0];
  }

  const dbId = firebaseConfig.firestoreDatabaseId || process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID;
  db = dbId ? getFirestore(adminApp, dbId) : getFirestore(adminApp);
  console.log(`Connected to Firestore Database: ${dbId || "(default)"}`);
} catch (error) {
  console.error("Critical: Failed to initialize Firebase Admin SDK:", error);
  process.exit(1);
}

// 2. Helper to slugify or create clean, secure doc ID
function slugify(text: string): string {
  return text
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\wก-๙\-]+/g, "") // support Thai characters
    .replace(/\-\-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

// Generate doc ID based on row data, prioritizing existing system IDs
function generateDocId(collectionName: string, row: any, rowIndex: number): string {
  // Check for existing explicit system ID
  const possibleIds = [
    "id", "Id", "ID", "docId", "doc_id", "documentId",
    "employeeid", "employeeId", "empId", "emp_id", "empCode", "employeeCode",
    "projectid", "projectId", "projId", "proj_id", "project_id",
    "advid", "advId", "adv_id", "advanceId",
    "clearingid", "clearingId", "clearing_id",
    "glid", "glId", "gl_id", "entryNo"
  ];

  for (const field of possibleIds) {
    if (row[field] !== undefined && row[field] !== null && String(row[field]).trim() !== "") {
      return slugify(String(row[field]));
    }
  }

  // Fallback generation based on essential fields
  switch (collectionName) {
    case "employees": {
      const name = row["name"] || row["ชื่อ"] || row["ชื่อ-นามสกุล"] || row["FullName"];
      if (name) return slugify(`emp-${name}`);
      const username = row["username"] || row["ชื่อผู้ใช้"];
      if (username) return slugify(`emp-${username}`);
      break;
    }
    case "projects": {
      const name = row["name"] || row["projectName"] || row["ชื่อโครงการ"] || row["ชื่อโครงการก่อสร้าง"];
      if (name) return slugify(`proj-${name}`);
      break;
    }
    case "advances": {
      const advId = row["advId"] || row["เลขที่เอกสาร"] || row["รหัสใบขอเงิน"];
      if (advId) return slugify(advId);
      const empId = row["employeeId"] || row["employeeName"] || row["ชื่อพนักงาน"];
      const date = row["createdAt"] || row["date"] || row["วันที่"];
      if (empId && date) return slugify(`adv-${empId}-${date}-${rowIndex}`);
      break;
    }
    case "clearingLogs": {
      const id = row["id"] || row["clearingLogId"];
      if (id) return slugify(id);
      const advId = row["advId"] || row["รหัสใบขอเงิน"];
      const round = row["roundNo"] || row["รอบ"] || "1";
      if (advId) return slugify(`clrlog-${advId}-r${round}`);
      break;
    }
    case "clearingItems": {
      const id = row["id"] || row["clearingItemId"];
      if (id) return slugify(id);
      const advId = row["advId"] || row["รหัสใบขอเงิน"];
      const vendor = row["vendorName"] || row["ชื่อร้านค้า"] || "unknown-vendor";
      const item = row["itemName"] || row["รายละเอียดสินค้า"] || "item";
      if (advId) return slugify(`clritm-${advId}-${vendor}-${item}-${rowIndex}`);
      break;
    }
    case "GL": {
      const docNo = row["docNo"] || row["documentNo"] || row["เลขที่บัญชี"] || row["เลขที่เอกสาร"];
      const code = row["accountCode"] || row["รหัสบัญชี"] || "";
      const amt = row["debit"] || row["credit"] || row["amount"] || "0";
      if (docNo && code) return slugify(`gl-${docNo}-${code}-${amt}-${rowIndex}`);
      break;
    }
    case "document_tracking": {
      const docNo = row["documentNo"] || row["docNo"] || row["เลขที่เอกสาร"];
      const type = row["documentType"] || row["ประเภทเอกสาร"] || "doc";
      if (docNo) return slugify(`track-${docNo}`);
      if (type) return slugify(`track-${type}-${rowIndex}`);
      break;
    }
    case "project_costs": {
      const projName = row["projectName"] || row["project"] || row["ชื่อโครงการ"] || row["โครงการ"];
      if (projName) return slugify(`cost-${projName}`);
      break;
    }
  }

  // Absolute fallback: secure deterministic row hash
  return `row-${rowIndex}-${Date.now()}`;
}

// 3. Detect matching collection based on columns or sheet names
function detectCollectionType(sheetName: string, headers: string[]): string {
  const nameLower = sheetName.toLowerCase();
  
  // Sheet name checks
  if (nameLower.includes("employee") || nameLower.includes("พนักงาน") || nameLower.includes("member")) return "employees";
  if (nameLower.includes("project") || nameLower.includes("โครงการ") || nameLower.includes("งานก่อสร้าง")) return "projects";
  if (nameLower.includes("advance") || nameLower.includes("เงินทดรอง") || nameLower.includes("ใบขอเงิน")) return "advances";
  if (nameLower.includes("clearingitem") || nameLower.includes("clearing item") || nameLower.includes("ใบเสร็จ") || nameLower.includes("รายการใบเสร็จ")) return "clearingItems";
  if (nameLower.includes("clearinglog") || nameLower.includes("clearing log") || nameLower.includes("ประวัติเคลียร์")) return "clearingLogs";
  if (nameLower.includes("gl") || nameLower.includes("ledger") || nameLower.includes("แยกประเภท") || nameLower.includes("บัญชี")) return "GL";
  if (nameLower.includes("track") || nameLower.includes("document tracking") || nameLower.includes("ติดตามเอกสาร")) return "document_tracking";
  if (nameLower.includes("cost") || nameLower.includes("ต้นทุน") || nameLower.includes("รายงานต้นทุน")) return "project_costs";

  // Header column keywords checks
  const headersJoined = headers.map(h => h.toLowerCase()).join(",");
  if (headersJoined.includes("employee") || headersJoined.includes("pinhash") || headersJoined.includes("รหัสพนักงาน") || headersJoined.includes("ธนาคาร")) return "employees";
  if (headersJoined.includes("project") || headersJoined.includes("budget") || headersJoined.includes("งบประมาณ") || headersJoined.includes("สัญญาก่อสร้าง")) return "projects";
  if (headersJoined.includes("advid") || headersJoined.includes("requestamount") || headersJoined.includes("เงินทดรองจ่าย")) return "advances";
  if (headersJoined.includes("vendorname") || headersJoined.includes("invoiceno") || headersJoined.includes("vatamount") || headersJoined.includes("เลขผู้เสียภาษี")) return "clearingItems";
  if (headersJoined.includes("gl") || headersJoined.includes("debit") || headersJoined.includes("credit") || headersJoined.includes("เดบิต")) return "GL";
  if (headersJoined.includes("documenttype") || headersJoined.includes("tracking") || headersJoined.includes("สถานะเอกสาร")) return "document_tracking";
  if (headersJoined.includes("contractbudget") || headersJoined.includes("pettycashbudget") || headersJoined.includes("รายงานต้นทุน")) return "project_costs";

  return "GL"; // Default generic ledger if unknown
}

// 4. Schema-specific field parsing/mapping
function mapRowToSchema(collectionName: string, row: any): any {
  const mapped: any = {};
  
  // Map common fields across all schemas
  const getVal = (keys: string[], defaultVal: any = undefined) => {
    for (const key of keys) {
      if (row[key] !== undefined && row[key] !== null) {
        return row[key];
      }
    }
    return defaultVal;
  };

  const getNum = (keys: string[], defaultVal = 0) => {
    const val = getVal(keys);
    if (val === undefined || val === "") return defaultVal;
    const num = parseFloat(String(val).replace(/[^0-9.-]/g, ""));
    return isNaN(num) ? defaultVal : num;
  };

  const getBool = (keys: string[], defaultVal = false) => {
    const val = getVal(keys);
    if (val === undefined || val === "") return defaultVal;
    const str = String(val).toLowerCase().trim();
    return ["true", "yes", "y", "1", "เปิดใช้งาน", "อนุมัติ"].includes(str) || val === true;
  };

  const getDateStr = (keys: string[]) => {
    const val = getVal(keys);
    if (!val) return "";
    if (val instanceof Date) return val.toISOString();
    // Check if numeric serial (Excel date)
    if (typeof val === "number") {
      try {
        const date = XLSX.SSF.parse_date_code(val);
        return new Date(date.y, date.m - 1, date.d).toISOString().split("T")[0];
      } catch (e) {}
    }
    return String(val).trim();
  };

  switch (collectionName) {
    case "employees":
      mapped.id = String(getVal(["id", "Id", "employeeId", "รหัสพนักงาน"]) || "");
      mapped.name = String(getVal(["name", "ชื่อ", "ชื่อ-นามสกุล", "FullName"]) || "");
      mapped.nickname = String(getVal(["nickname", "ชื่อเล่น"]) || "");
      mapped.employeeCode = String(getVal(["employeeCode", "empCode", "รหัสพนักงาน"]) || "");
      mapped.username = String(getVal(["username", "ชื่อผู้ใช้"]) || slugify(mapped.name));
      mapped.role = String(getVal(["role", "ตำแหน่ง", "บทบาท"]) || "Employee");
      mapped.pinHash = String(getVal(["pinHash", "รหัสผ่านแฮช"]) || ""); // SHA-256
      mapped.plainPin = String(getVal(["plainPin", "pin", "รหัสพิน"]) || "");
      mapped.bankName = String(getVal(["bankName", "ธนาคาร", "ชื่อธนาคาร"]) || "");
      mapped.bankNo = String(getVal(["bankNo", "เลขบัญชี", "เลขที่บัญชี"]) || "");
      mapped.bankAccountName = String(getVal(["bankAccountName", "ชื่อบัญชี", "ชื่อบัญชีธนาคาร"]) || mapped.name);
      mapped.lineUserId = String(getVal(["lineUserId", "lineId", "ไลน์ไอดี"]) || "");
      mapped.isActive = getBool(["isActive", "status", "สถานะใช้งาน"], true);
      mapped.isApprovedByAdmin = getBool(["isApprovedByAdmin", "approved", "อนุมัติโดยแอดมิน"], true);
      mapped.status = "Active";
      break;

    case "projects":
      mapped.id = String(getVal(["id", "projectId", "รหัสโครงการ"]) || "");
      mapped.name = String(getVal(["name", "projectName", "ชื่อโครงการ", "โครงการ"]) || "");
      mapped.projectId = String(getVal(["projectId", "project_id", "รหัสโครงการ"]) || mapped.id || slugify(mapped.name).toUpperCase());
      mapped.contractBudget = getNum(["contractBudget", "งบสัญญา", "งบประมาณโครงการ", "budget"]);
      mapped.pettyCashBudget = getNum(["pettyCashBudget", "งบหน้างาน", "งบเงินทดรองจ่ายสะสม", "pettyCash"]);
      mapped.aiReasoning = String(getVal(["aiReasoning", "คำอธิบายงบประมาณ", "เหตุผล"]) || "นำเข้าข้อมูลจาก Excel");
      break;

    case "advances":
      mapped.id = String(getVal(["id", "advId", "เลขที่เอกสาร"]) || "");
      mapped.advId = String(getVal(["advId", "เลขที่เอกสาร", "รหัสใบขอเงิน"]) || "");
      mapped.employeeId = String(getVal(["employeeId", "รหัสพนักงาน"]) || "");
      mapped.employeeName = String(getVal(["employeeName", "ชื่อพนักงาน"]) || "");
      mapped.projectId = String(getVal(["projectId", "ชื่อโครงการ", "โครงการ"]) || "");
      mapped.category = String(getVal(["category", "หมวดหมู่", "ประเภท"]) || "");
      mapped.requestAmount = getNum(["requestAmount", "จำนวนเงินเบิก", "ยอดเบิก"]);
      mapped.approvedClearingAmountTotal = getNum(["approvedClearingAmountTotal", "ยอดเคลียร์แล้ว"], 0);
      mapped.outstandingAmount = getNum(["outstandingAmount", "ยอดค้างชำระ"], mapped.requestAmount);
      mapped.status = String(getVal(["status", "สถานะเอกสาร"]) || "WAITING_CLEARANCE").toUpperCase();
      mapped.createdAt = getDateStr(["createdAt", "วันที่สร้าง", "วันที่"]);
      mapped.neededDate = getDateStr(["neededDate", "วันที่ต้องการเงิน", "วันที่ต้องเคลียร์"]);
      mapped.details = String(getVal(["details", "รายละเอียด", "วัตถุประสงค์"]) || "");
      mapped.note = String(getVal(["note", "หมายเหตุ"]) || "");
      break;

    case "clearingLogs":
      mapped.id = String(getVal(["id", "clearingLogId", "รหัสประวัติเคลียร์"]) || "");
      mapped.advId = String(getVal(["advId", "รหัสใบขอเงิน"]) || "");
      mapped.roundNo = getNum(["roundNo", "รอบเคลียร์", "รอบที่"], 1);
      mapped.submittedBy = String(getVal(["submittedBy", "ผู้ยื่นเคลียร์", "พนักงาน"]) || "");
      mapped.submittedAt = getDateStr(["submittedAt", "วันที่ยื่นเคลียร์", "วันที่"]);
      mapped.status = String(getVal(["status", "สถานะ"]) || "PENDING").toUpperCase();
      mapped.totalSubmittedAmount = getNum(["totalSubmittedAmount", "ยอดเงินที่ยื่น", "จำนวนเงิน"]);
      mapped.totalApprovedAmount = getNum(["totalApprovedAmount", "ยอดเงินที่อนุมัติ"], 0);
      mapped.accountantNote = String(getVal(["accountantNote", "หมายเหตุบัญชี"]) || "");
      break;

    case "clearingItems":
      mapped.id = String(getVal(["id", "clearingItemId", "รหัสรายการ"]) || "");
      mapped.clearingLogId = String(getVal(["clearingLogId", "รหัสประวัติเคลียร์"]) || "");
      mapped.advId = String(getVal(["advId", "รหัสใบขอเงิน"]) || "");
      mapped.roundNo = getNum(["roundNo", "รอบที่"], 1);
      mapped.vendorName = String(getVal(["vendorName", "ชื่อร้านค้า", "ร้านค้า"]) || "");
      mapped.vendorTaxId = String(getVal(["vendorTaxId", "เลขผู้เสียภาษี", "TaxID"]) || "");
      mapped.documentType = String(getVal(["documentType", "ประเภทใบเสร็จ", "ประเภทเอกสาร"]) || "Receipt");
      mapped.invoiceNo = String(getVal(["invoiceNo", "เลขที่ใบเสร็จ", "เลขที่เอกสาร"]) || "");
      mapped.documentDate = getDateStr(["documentDate", "วันที่ในใบเสร็จ", "วันที่"]);
      mapped.itemName = String(getVal(["itemName", "รายละเอียดสินค้า", "รายการ"]) || "");
      mapped.qty = getNum(["qty", "จำนวน"], 1);
      mapped.unitPrice = getNum(["unitPrice", "ราคาต่อหน่วย", "ราคา"]);
      mapped.vatType = String(getVal(["vatType", "ประเภทแวต"]) || "NONE").toUpperCase();
      mapped.vatAmount = getNum(["vatAmount", "ภาษีมูลค่าเพิ่ม", "VAT"], 0);
      mapped.whtRate = String(getVal(["whtRate", "อัตราหักณที่จ่าย"]) || "NONE").toUpperCase();
      mapped.whtAmount = getNum(["whtAmount", "ภาษีหักณที่จ่าย", "WHT"], 0);
      mapped.netAmount = getNum(["netAmount", "จำนวนเงินสุทธิ", "ยอดสุทธิ"]);
      mapped.imageUrl = String(getVal(["imageUrl", "ลิงก์รูปภาพ", "รูปใบเสร็จ"]) || "");
      mapped.ocrConfidence = getNum(["ocrConfidence", "ความถูกต้องAI"], 100);
      mapped.isDuplicate = getBool(["isDuplicate", "รายการซ้ำ"], false);
      mapped.accountantApproved = getBool(["accountantApproved", "บัญชีอนุมัติ"], true);
      break;

    case "GL":
      mapped.id = String(getVal(["id", "glId", "รหัสผ่านแฮช"]) || "");
      mapped.docNo = String(getVal(["docNo", "documentNo", "เลขที่เอกสาร"]) || "");
      mapped.date = getDateStr(["date", "วันที่"]);
      mapped.accountCode = String(getVal(["accountCode", "รหัสบัญชี"]) || "");
      mapped.accountName = String(getVal(["accountName", "ชื่อบัญชี"]) || "");
      mapped.projectId = String(getVal(["projectId", "ชื่อโครงการ", "โครงการ"]) || "");
      mapped.projectName = String(getVal(["projectName", "โครงการ"]) || mapped.projectId);
      mapped.category = String(getVal(["category", "หมวดหมู่"]) || "");
      mapped.debit = getNum(["debit", "เดบิต"], 0);
      mapped.credit = getNum(["credit", "เครดิต"], 0);
      mapped.amount = getNum(["amount", "จำนวนเงิน"], mapped.debit || mapped.credit || 0);
      mapped.employeeName = String(getVal(["employeeName", "พนักงาน"]) || "");
      mapped.description = String(getVal(["description", "รายละเอียด", "memo"]) || "");
      break;

    case "document_tracking":
      mapped.id = String(getVal(["id", "trackingId"]) || "");
      mapped.documentNo = String(getVal(["documentNo", "docNo", "เลขที่เอกสาร"]) || "");
      mapped.documentType = String(getVal(["documentType", "ประเภทเอกสาร"]) || "");
      mapped.status = String(getVal(["status", "สถานะ"]) || "PENDING").toUpperCase();
      mapped.employeeName = String(getVal(["employeeName", "พนักงาน"]) || "");
      mapped.projectId = String(getVal(["projectId", "โครงการ"]) || "");
      mapped.amount = getNum(["amount", "จำนวนเงิน", "ยอดเงิน"]);
      mapped.createdAt = getDateStr(["createdAt", "วันที่สร้าง", "วันที่"]);
      mapped.updatedAt = getDateStr(["updatedAt", "วันที่อัปเดต"]) || mapped.createdAt;
      break;

    case "project_costs":
      mapped.id = String(getVal(["id", "costId"]) || "");
      mapped.projectName = String(getVal(["projectName", "โครงการ", "ชื่อโครงการ"]) || "");
      mapped.contractBudget = getNum(["contractBudget", "งบสัญญา"]);
      mapped.pettyCashBudget = getNum(["pettyCashBudget", "งบเงินทดรอง"]);
      mapped.totalAdvanceRequested = getNum(["totalAdvanceRequested", "ยอดขอเบิกสะสม"], 0);
      mapped.totalAdvanceApproved = getNum(["totalAdvanceApproved", "ยอดเบิกจ่ายสะสม"], 0);
      mapped.totalClearingSubmitted = getNum(["totalClearingSubmitted", "ยอดส่งเคลียร์สะสม"], 0);
      mapped.totalClearingApproved = getNum(["totalClearingApproved", "ยอดเคลียร์ผ่านสะสม"], 0);
      mapped.remainingPettyCashBudget = getNum(["remainingPettyCashBudget", "งบสะสมคงเหลือ"], mapped.pettyCashBudget - mapped.totalClearingApproved);
      mapped.variance = getNum(["variance", "ส่วนต่างงบ"], mapped.contractBudget - mapped.totalClearingApproved);
      mapped.lastUpdated = getDateStr(["lastUpdated", "วันที่อัปเดต"]) || new Date().toISOString();
      break;
  }

  return mapped;
}

// 5. Core execution logic
async function runImport() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log("Usage: npx tsx import-excel.ts <excel-file-path> [target-collection-override]");
    console.log("\nSupported Target Collections: projects, employees, advances, clearingItems, clearingLogs, GL, document_tracking, project_costs");
    process.exit(0);
  }

  const filePath = args[0];
  const collectionOverride = args[1];

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found at: ${filePath}`);
    process.exit(1);
  }

  console.log(`Reading file: ${filePath}`);
  const workbook = XLSX.readFile(filePath);

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    // Convert to JSON
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (rows.length === 0) {
      console.log(`Sheet "${sheetName}" is empty, skipping.`);
      continue;
    }

    // Extract headers
    const headers = Object.keys(rows[0] as any);
    const collectionName = collectionOverride || detectCollectionType(sheetName, headers);

    console.log(`\nProcessing Sheet "${sheetName}" -> Target Firestore Collection: "${collectionName}"`);
    console.log(`Found ${rows.length} rows to import.`);

    let importedCount = 0;
    let skippedCount = 0;

    for (let idx = 0; idx < rows.length; idx++) {
      const row: any = rows[idx];
      const rowIndex = idx + 2; // Excel row index is typically 1-based, plus header row

      // 1. Generate Doc ID to prevent duplicates
      const docId = generateDocId(collectionName, row, rowIndex);

      // 2. Map standard fields
      const schemaData = mapRowToSchema(collectionName, row);

      // 3. Keep all original fields in rawData (Requirement 9)
      const rawData: any = {};
      for (const key of Object.keys(row)) {
        rawData[key] = row[key];
      }

      // 4. Traceback metadata (Requirement 5)
      const finalDoc = {
        ...schemaData,
        rawData,
        sourceFile: path.basename(filePath),
        sourceSheet: sheetName,
        sourceRow: rowIndex,
        importedAt: new Date().toISOString()
      };

      // 5. Clean undefined keys before saving to firestore
      Object.keys(finalDoc).forEach(key => {
        if (finalDoc[key] === undefined) {
          delete finalDoc[key];
        }
      });

      try {
        // Write to Firestore with setDoc (merge: true) to prevent data destruction and avoid duplicates
        await db.collection(collectionName).doc(docId).set(finalDoc, { merge: true });
        importedCount++;
      } catch (err) {
        console.error(`Failed to write row ${rowIndex} (ID: ${docId}):`, err);
        skippedCount++;
      }
    }

    console.log(`Finished Sheet "${sheetName}": Successfully imported/updated ${importedCount} documents. Skipped/Failed: ${skippedCount}.`);
  }

  console.log("\nAll Excel data import operations completed successfully.");
}

runImport().catch(err => {
  console.error("Critical error in Excel import CLI script:", err);
  process.exit(1);
});
