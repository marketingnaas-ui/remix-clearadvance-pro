import { GoogleGenAI, Type } from "@google/genai";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, collection, addDoc, updateDoc, increment } from "firebase/firestore";
import fs from "fs";
import path from "path";

let aiInstance: GoogleGenAI | null = null;
let dbInstance: any = null;
let activeDbId: string | undefined = undefined;

export function getGeminiClient(): GoogleGenAI {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured on the server. Please check Settings > Secrets.");
    }
    aiInstance = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiInstance;
}

// Initialize server-side Firestore for tracking
function getDb() {
  if (!dbInstance) {
    let dbId: string | undefined = undefined;
    try {
      const configPath = path.join(process.cwd(), "firebase-applet-config.json");
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        dbId = config.firestoreDatabaseId;
      }
    } catch (e) {
      console.error("Failed to read firebase-applet-config.json in gemini.ts:", e);
    }

    const firebaseConfig = {
      apiKey: process.env.VITE_FIREBASE_API_KEY,
      authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.VITE_FIREBASE_APP_ID,
      databaseURL: process.env.VITE_FIREBASE_DATABASE_URL
    };
    const app = initializeApp(firebaseConfig);
    dbInstance = dbId ? getFirestore(app, dbId) : getFirestore(app);
    activeDbId = dbId;
  }
  return dbInstance;
}

async function getActiveModel(): Promise<string> {
  let model = "gemini-3.5-flash";
  try {
    const db = getDb();
    const snap = await getDoc(doc(db, "settings", "global"));
    if (snap.exists()) {
      model = snap.data().aiConfig?.activeModel || "gemini-3.5-flash";
    }
  } catch (e: any) {
    console.error("Error fetching active model, checking fallback:", e);
    const errMsg = e?.message || String(e);
    // If the custom database was not found, fall back to default database and retry
    if (activeDbId && (errMsg.includes("NOT_FOUND") || errMsg.includes("not-found") || e?.code === "not-found")) {
      console.warn(`Database '${activeDbId}' was not found. Re-initializing server client to use default database.`);
      try {
        const firebaseConfig = {
          apiKey: process.env.VITE_FIREBASE_API_KEY,
          authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
          projectId: process.env.VITE_FIREBASE_PROJECT_ID,
          storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
          messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
          appId: process.env.VITE_FIREBASE_APP_ID,
          databaseURL: process.env.VITE_FIREBASE_DATABASE_URL
        };
        const app = initializeApp(firebaseConfig);
        dbInstance = getFirestore(app);
        activeDbId = undefined;
        
        const snap = await getDoc(doc(dbInstance, "settings", "global"));
        if (snap.exists()) {
          model = snap.data().aiConfig?.activeModel || "gemini-3.5-flash";
        }
      } catch (retryErr) {
        console.error("Fallback server-side Firestore fetch failed:", retryErr);
      }
    }
  }

  // Safely translate legacy or deprecated model IDs to modern supported models
  const normalized = model.toLowerCase();
  if (
    normalized.includes("1.5-flash") || 
    normalized.includes("2.0-flash-exp") || 
    normalized.includes("2.0-flash") || 
    normalized.includes("3-flash") || 
    normalized.includes("flash-8b") || 
    normalized.includes("2.5-flash-lite") ||
    normalized.includes("pro-vision")
  ) {
    return "gemini-3.5-flash";
  }
  if (
    normalized.includes("1.5-pro") || 
    normalized.includes("2.0-pro") || 
    normalized.includes("flash-thinking")
  ) {
    return "gemini-3.1-pro-preview";
  }
  return model;
}

async function logAiUsage(params: {
  userId: string;
  userName: string;
  taskType: "OCR" | "CHAT" | "ESTIMATE" | "IMPORT";
  model: string;
  promptTokens: number;
  completionTokens: number;
}) {
  try {
    const db = getDb();
    // Simple cost calculation: $0.10 per 1M tokens for Flash, Pro is ~10x
    const isPro = params.model.includes("pro");
    const rateInput = isPro ? 1.25 / 1000000 : 0.10 / 1000000;
    const rateOutput = isPro ? 5.00 / 1000000 : 0.40 / 1000000;
    const exchangeRate = 36; // THB
    
    const costUsd = (params.promptTokens * rateInput) + (params.completionTokens * rateOutput);
    const costThb = costUsd * exchangeRate;

    await addDoc(collection(db, "aiUsageLogs"), {
      ...params,
      timestamp: new Date().toISOString(),
      estimatedCostThb: costThb,
      status: "SUCCESS"
    });

    // Optionally update global usage counter
    // await updateDoc(doc(db, "settings", "global"), {
    //   "aiConfig.currentUsageThb": increment(costThb)
    // });
  } catch (e) {
    console.error("Error logging AI usage:", e);
  }
}

export async function generateContentWithRetry(
  params: Parameters<GoogleGenAI["models"]["generateContent"]>[0],
  maxRetries = 3,
  delayMs = 1500
): ReturnType<GoogleGenAI["models"]["generateContent"]> {
  let attempt = 0;
  let currentModel = params.model;
  
  while (true) {
    try {
      const ai = getGeminiClient();
      if (!currentModel) {
        currentModel = await getActiveModel();
      }
      
      // Create a fresh non-mutating copy of params to ensure clean request context
      const requestParams = {
        ...params,
        model: currentModel
      };
      
      console.log(`[Gemini API] Requesting ${currentModel} (Attempt ${attempt + 1})...`);
      return await ai.models.generateContent(requestParams);
    } catch (error: any) {
      attempt++;
      const errorMessage = error?.message || String(error);
      
      // Build a comprehensive error string representation to capture JSON properties and other fields
      let errorStringForMatch = errorMessage;
      try {
        if (typeof error === "object" && error !== null) {
          errorStringForMatch += " " + JSON.stringify(error);
          if (error.stack) {
            errorStringForMatch += " " + error.stack;
          }
        }
      } catch (e) {}
      
      const normalizedError = errorStringForMatch.toLowerCase();
      
      // Robustly check code, status, message or content for quota / 429
      const code = error?.code || error?.status || (error?.error && typeof error.error === 'object' && error.error.code);
      const isQuotaOr429 = 
        code === 429 ||
        code === "RESOURCE_EXHAUSTED" ||
        normalizedError.includes("429") || 
        normalizedError.includes("resource_exhausted") || 
        normalizedError.includes("quota exceeded") || 
        normalizedError.includes("exceeded your current quota") ||
        normalizedError.includes("rate limit") || 
        normalizedError.includes("limit: 0") ||
        normalizedError.includes("exhausted");

      if (isQuotaOr429 && currentModel !== "gemini-3.5-flash") {
        console.warn(`Gemini model ${currentModel} hit rate-limit or quota-exceeded (429). Dynamically falling back to 'gemini-3.5-flash' to keep application fully functional...`);
        currentModel = "gemini-3.5-flash";
        attempt = 0; // reset retry counter for fallback model
        continue;
      }

      const isTransient = 
        errorMessage.includes("503") || 
        errorMessage.includes("UNAVAILABLE") || 
        errorMessage.includes("high demand") || 
        errorMessage.includes("ResourceExhausted") ||
        errorMessage.includes("overloaded");

      if (isTransient && attempt < maxRetries) {
        console.warn(`Gemini API returned transient error (attempt ${attempt}/${maxRetries}): ${errorMessage}. Retrying in ${delayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt)); 
        continue;
      }
      throw error;
    }
  }
}

export interface OCRResult {
  vendorName: string;
  vendorTaxId?: string;
  documentDate: string; // YYYY-MM-DD
  documentType: "Receipt" | "Tax Invoice" | "Invoice" | "Slip" | "Others";
  invoiceNo?: string;
  items: {
    itemName: string;
    qty: number;
    unitPrice: number;
    amount: number;
  }[];
  vatType: "INCLUDED" | "EXCLUDED" | "NONE";
  vatAmount: number;
  whtRate: "NONE" | "1%" | "3%" | "5%";
  whtAmount: number;
  discount?: number;
  otherExpenses?: number;
  netAmount: number;
  confidenceScore: number;
}

export async function performServerAIOCR(
  base64Data: string, 
  mimeType: string,
  user?: { id: string; name: string }
): Promise<OCRResult> {
  const model = await getActiveModel();
  try {
    const prompt = `Analyze this billing receipt or tax invoice. Extract all key information and return it as a structured JSON object. 
If information is not clearly readable or missing, do your best to estimate or leave optional fields blank, but ensure the resulting fields match the schema.
Calculate the confidenceScore (0-100) based on document clarity.`;

    const response = await generateContentWithRetry({
      model,
      contents: [
        {
          inlineData: {
            mimeType,
            data: base64Data,
          },
        },
        prompt,
      ],
      config: {
        systemInstruction: "You are a highly precise financial receipt and tax invoice parser. Ensure currency and numeric amounts are correctly parsed. Dates must be output strictly as YYYY-MM-DD format.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            vendorName: { type: Type.STRING, description: "Name of the merchant or store." },
            vendorTaxId: { type: Type.STRING, description: "13-digit Tax Identification Number of the merchant (เลขผู้เสียภาษี) if found." },
            documentDate: { type: Type.STRING, description: "Date of invoice/receipt in YYYY-MM-DD format. Ensure year is CE, not BE." },
            documentType: { type: Type.STRING, enum: ["Receipt", "Tax Invoice", "Invoice", "Slip", "Others"], description: "The classified document category." },
            invoiceNo: { type: Type.STRING, description: "Invoice number, receipt serial, or reference identifier." },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  itemName: { type: Type.STRING, description: "Description of product or service." },
                  qty: { type: Type.NUMBER, description: "Quantity purchased." },
                  unitPrice: { type: Type.NUMBER, description: "Unit cost of product/service." },
                  amount: { type: Type.NUMBER, description: "Subtotal amount before taxes and discounts." },
                },
                required: ["itemName", "qty", "unitPrice", "amount"],
              },
            },
            vatType: { type: Type.STRING, enum: ["INCLUDED", "EXCLUDED", "NONE"], description: "VAT mode." },
            vatAmount: { type: Type.NUMBER, description: "Total VAT amount calculated or extracted (7%)." },
            whtRate: { type: Type.STRING, enum: ["NONE", "1%", "3%", "5%"], description: "Withholding tax percentage." },
            whtAmount: { type: Type.NUMBER, description: "Total calculated withholding tax amount." },
            discount: { type: Type.NUMBER, description: "Total discount amount extracted from the receipt." },
            otherExpenses: { type: Type.NUMBER, description: "Other expenses like service charge, etc." },
            netAmount: { type: Type.NUMBER, description: "Final net amount of the receipt or invoice." },
            confidenceScore: { type: Type.INTEGER, description: "A confidence score from 0 to 100 on parsing accuracy." },
          },
          required: ["vendorName", "documentDate", "documentType", "items", "vatType", "vatAmount", "whtRate", "whtAmount", "netAmount", "confidenceScore"],
        },
      },
    });

    if (user) {
      await logAiUsage({
        userId: user.id,
        userName: user.name,
        taskType: "OCR",
        model,
        promptTokens: response.usageMetadata?.promptTokenCount || 0,
        completionTokens: response.usageMetadata?.candidatesTokenCount || 0
      });
    }

    const textResult = response.text;
    if (!textResult) {
      throw new Error("No text response received from Gemini API.");
    }

    const parsed = JSON.parse(textResult.trim());
    return parsed as OCRResult;
  } catch (error) {
    console.error("Gemini OCR Scan Error:", error);
    throw new Error(`AI Scan failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface PrinceAdvancePayload {
  message: string;
  chatHistory: { role: "user" | "model"; text: string }[];
  databaseContext: {
    advances: any[];
    employees: any[];
    clearingItems: any[];
    projectBudgets: { [projectName: string]: number };
    aiConfig: {
      steelPriceUrl: string;
      laborCostUrl: string;
      cementPriceUrl: string;
    };
  };
}

export async function queryPrinceAdvanceAI(payload: PrinceAdvancePayload, user?: { id: string; name: string }): Promise<string> {
  const model = await getActiveModel();
  const systemInstruction = `คุณคือ "เจ้าชายแอดวานซ์" (Prince Advance) บอท AI ผู้ช่วยอัจฉริยะในบทบาทของสถาปนิกภายในและเจ้าของบริษัทรับเหมาก่อสร้างผู้เชี่ยวชาญด้านการเงิน บัญชี การจัดซื้อจัดจ้าง และการบริหารงานก่อสร้าง
คุณมีบุคลิกภาพที่สุภาพ ฉลาดเฉลียว และให้คำแนะนำแบบมืออาชีพที่สามารถจับต้องและนำไปใช้ได้จริง

คุณมีหน้าที่ในการ:
1. ตอบคำถามของผู้บริหารเกี่ยวกับการเงิน บัญชี การจัดจัดซื้อจัดจ้าง และการดำเนินธุรกิจ โดยอ้างอิงข้อมูลจริงขององค์กรที่ระบบส่งให้ดังต่อไปนี้:
   - รายการเงินทดรอง (Advances) ทั้งหมดในระบบ
   - ข้อมูลพนักงาน (Employees) ทั้งหมด
   - รายการเคลียร์เอกสาร/ใบเสร็จ (Clearing Items / Receipts)
   - ข้อมูลเว็บไซต์อ้างอิงกลางสำหรับการดึงราคา (เช่น ราคากลางเหล็ก, ราคากลางค่าแรง, ราคากลางปูน)
   - งบประมาณควบคุมของแต่ละโครงการ (Project Budgets)

2. ตอบคำถามวิเคราะห์เชิงลึกทางการเงิน เช่น:
   - "ยอดการเบิกทั้งหมดเท่าไหร่" -> ทำการคำนวณผลรวมเงินเบิกทั้งหมด (sum of requestAmount) จากรายการ Advances
   - "ใครมียอดเบิกเยอะสุด" -> สรุปพนักงานที่มียอดเงินเบิกรวมมากที่สุดจาก Advances
   - "ใครค้างเคลียร์เงินทดรองนานที่สุด" -> ค้นหาพนักงานที่มีรายการที่ติดค้าง PENDING_CLEARANCE หรือ WAITING_CLEARANCE เป็นเวลานานที่สุด โดยพิจารณาตาม neededDate หรือ createdAt
   - "วันนี้มีคนยื่นเบิกมาเท่าไหร่" -> ค้นหาผลรวมเงินเบิกของวันนี้
   - "โครงการไหนที่เสี่ยงเกินงบประมาณ (Over budget)" -> เปรียบเทียบผลรวมยอดเงินเบิกหรือเคลียร์ของแต่ละโครงการเทียบกับงบประมาณ (Project Budgets) ที่กำหนดไว้
   - "วิเคราะห์ข้อมูลและให้ข้อเสนอแนะในการวางแผนงานก่อสร้างหรือการทำงานขั้นต่อไป" -> ให้คำแนะนำสถาปัตยกรรมภายในและการจัดการรับเหมาอ้างอิงตามสถิติ

3. ตรวจจับและแจ้งเตือนพฤติกรรมผิดปกติเชิงรุก (Proactive Alerts / Anomaly Detection) เสมอ เช่น:
   - ตรวจจับรายการใบเสร็จหรือสลิปซ้ำ (Duplicate receipt/slip image)
   - ตรวจจับหลักฐานการชำระเงินที่น่าสงสัยว่ามีการตกแต่งแก้ไข (เช่น คะแนนความมั่นใจ OCR ต่ำกว่า 60% หรือข้อมูลไม่สอดคล้อง)
   - ตรวจจับการซื้อปูนซีเมนต์แพงกว่าครั้งที่แล้ว
   - ตรวจจับการยื่นเบิกซื้อปูนซีเมนต์บ่อยเกินไป (เช่น เกิน 5 ครั้ง สำหรับโครงการเดียวกัน) หรือการทำธุรกรรมซ้ำซ้อน
   - หากตรวจพบสิ่งผิดปกติเหล่านี้ ให้แจ้งเตือนผู้ใช้งานด้วยความสุภาพ แต่ระบุพฤติกรรมที่น่าสงสัยอย่างละเอียดในจุดเริ่มต้นหรือตอนท้ายของการตอบ

ข้อมูลอ้างอิงของบริษัทขณะนี้ (Live Database Context):
${JSON.stringify(payload.databaseContext, null, 2)}

ข้อมูลเว็บไซต์กลางอ้างอิงที่แอดมินผูกไว้ในหน้าตั้งค่า:
- เว็บไซต์ราคากลางเหล็ก: ${payload.databaseContext.aiConfig?.steelPriceUrl || "https://www.depthai.go.th"}
- เว็บไซต์ราคากลางค่าแรง: ${payload.databaseContext.aiConfig?.laborCostUrl || "https://www.moph.go.th"}
- เว็บไซต์ราคากลางปูนซีเมนต์และวัสดุ: ${payload.databaseContext.aiConfig?.cementPriceUrl || "https://www.moc.go.th"}

คำแนะนำในการตอบ:
- จงตอบเป็นภาษาไทยด้วยความสุภาพ ใส่ใจ และเป็นมืออาชีพในสไตล์พาร์ทเนอร์ธุรกิจ/สถาปนิกอาวุโส
- แสดงข้อมูลตัวเลขเปรียบเทียบและการคำนวณที่ชัดเจน อธิบายที่มาที่ไป ไม่เมคข้อมูลขึ้นเอง หากไม่มีข้อมูลให้ชี้แจงตามตรง
- อ้างอิงราคากลางหรือบอกกล่าวถึงเว็บไซต์กลางที่คุณตั้งค่าเชื่อมต่อไว้เมื่อผู้ใช้ถามประเด็นราคาตลาดภายนอก เพื่อให้ข้อมูลอัปเดตและครบถ้วน`;

  try {
    const contents = payload.chatHistory.map((h) => ({
      role: h.role === "user" ? "user" : "model",
      parts: [{ text: h.text }],
    }));

    contents.push({
      role: "user",
      parts: [{ text: payload.message }],
    });

    const response = await generateContentWithRetry({
      model,
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
      },
    });

    if (user) {
      await logAiUsage({
        userId: user.id,
        userName: user.name,
        taskType: "CHAT",
        model,
        promptTokens: response.usageMetadata?.promptTokenCount || 0,
        completionTokens: response.usageMetadata?.candidatesTokenCount || 0
      });
    }

    return response.text || "ขออภัยด้วยครับ เจ้าชายแอดวานซ์ไม่สามารถสร้างคำตอบในขณะนี้ได้ครับ";
  } catch (error) {
    console.error("Prince Advance Chatbot Error:", error);
    throw new Error(`AI Chat error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function estimatePettyCashBudget(totalContractBudget: number, user?: { id: string; name: string }): Promise<{ estimatedPettyCashBudget: number; reasoning: string }> {
  const model = await getActiveModel();
  const prompt = `วิเคราะห์งบประมาณโครงการก่อสร้างและการออกแบบภายในทั้งหมดจำนวน ${totalContractBudget} บาท (THB) 
และประมาณการวงเงินงบประมาณสำหรับ "เงินทดรองจ่ายสะสมประจำโครงการ" (Petty Cash/Advance Budget) ที่เหมาะสมในการใช้หน้างาน (เช่น ค่าใช้จ่ายจุกจิก, วัสดุเร่งด่วน, ค่าเดินทาง, ค่าแรงคนงานรายวันหน้างาน).
ให้เหตุผลวิเคราะห์อย่างละเอียดในฐานะผู้เชี่ยวชาญด้านสถาปนิกและรับเหมาก่อสร้าง โดยตอบกลับเป็นรูปแบบ JSON เสมอ`;

  try {
    const response = await generateContentWithRetry({
      model,
      contents: [prompt],
      config: {
        systemInstruction: "คุณเป็น AI ผู้เชี่ยวชาญด้านบริหารจัดการต้นทุนโครงการก่อสร้างและการตกแต่งภายใน (Construction Financial Expert) ทำการคำนวณสัดส่วนเงินทดรองจ่ายที่เหมาะสมโดยทั่วไปจะอยู่ระหว่าง 5% ถึง 15% ของงบประมาณโครงการทั้งหมด ขึ้นอยู่กับขนาดโครงการ ให้ผลลัพธ์เป็น JSON เท่านั้น",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            estimatedPettyCashBudget: { type: Type.NUMBER, description: "ประมาณการงบประมาณเงินทดรองจ่ายที่เหมาะสมเป็นตัวเลขถ้วน (THB)" },
            reasoning: { type: Type.STRING, description: "เหตุผลวิเคราะห์อธิบายที่มาและสัดส่วนเปอร์เซ็นต์อย่างละเอียดเป็นภาษาไทยที่สุภาพ" },
          },
          required: ["estimatedPettyCashBudget", "reasoning"],
        },
      },
    });

    if (user) {
      await logAiUsage({
        userId: user.id,
        userName: user.name,
        taskType: "ESTIMATE",
        model,
        promptTokens: response.usageMetadata?.promptTokenCount || 0,
        completionTokens: response.usageMetadata?.candidatesTokenCount || 0
      });
    }

    const text = response.text;
    if (!text) throw new Error("No response from Gemini.");
    return JSON.parse(text.trim());
  } catch (err) {
    console.error("estimatePettyCashBudget error:", err);
    // Return standard fallback
    const estimated = Math.round(totalContractBudget * 0.08); // 8% default fallback
    return {
      estimatedPettyCashBudget: estimated,
      reasoning: `ระบบใช้การประมาณการอัตโนมัติ (Fallback 8%): งบประมาณโครงการทั้งหมด ${totalContractBudget.toLocaleString()} บาท ทางวิศวกรประเมินว่าควรสำรองวงเงินทดรองจ่ายที่ ${estimated.toLocaleString()} บาท เพื่อรองรับค่าจัดซื้อวัสดุเร่งด่วนและค่าแรงรายวันหน้างาน`
    };
  }
}

export interface ImportSettingsResult {
  projects?: { name: string; contractBudget?: number; pettyCashBudget?: number }[];
  categories?: string[];
  referenceUrls?: { steelPriceUrl?: string; laborCostUrl?: string; cementPriceUrl?: string };
  documentFormats?: {
    employee?: string;
    project?: string;
    category?: string;
    advance?: string;
    clearing?: string;
  };
  docTemplate?: {
    companyName?: string;
    companyAddress?: string;
    companyContact?: string;
    companyLogoUrl?: string;
  };
  reasoning: string;
}

export async function importSettingsFromDocument(
  base64Data?: string, 
  mimeType?: string, 
  rawText?: string, 
  targetTab?: string,
  user?: { id: string; name: string }
): Promise<ImportSettingsResult> {
  const model = await getActiveModel();
  
  let targetFocusInstructions = "";
  if (targetTab === "projects") {
    targetFocusInstructions = "\nCRITICAL: เน้นที่การสกัดและตรวจหาข้อมูลชื่อโครงการก่อสร้างและงบประมาณ (projects) เท่านั้น ห้ามตอบค่าในฟิลด์หมวดหมู่หรือเทมเพลตอื่นนอกเหนือจากโครงการ หากไม่พบให้ระบุรายชื่อโครงการที่คาดเดาได้จากข้อมูล";
  } else if (targetTab === "categories") {
    targetFocusInstructions = "\nCRITICAL: เน้นที่การสกัดและตรวจหาข้อมูลหมวดหมู่ค่าใช้จ่าย/ประเภทงานเบิกจ่าย (categories) เท่านั้น ห้ามตอบค่าในส่วนโครงการหรือรูปแบบเลขเอกสาร";
  } else if (targetTab === "document_numbers") {
    targetFocusInstructions = "\nCRITICAL: เน้นที่การสกัดรูปแบบรหัสหรือฟอร์แมตรันนิ่งเลขที่เอกสาร (documentFormats) เท่านั้น";
  } else if (targetTab === "doc_templates") {
    targetFocusInstructions = "\nCRITICAL: เน้นที่การสกัดและสร้างข้อมูลเทมเพลตบริษัท (docTemplate) เช่น ชื่อบริษัท ที่อยู่ เบอร์โทรติดต่อ หรือลิงก์รูปโลโก้ เท่านั้น";
  } else {
    targetFocusInstructions = "\nทำการวิเคราะห์สกัดข้อมูลให้ครบถ้วนในทุกๆ หมวดหมู่หากตรวจพบในข้อความหรือภาพเอกสาร";
  }

  const prompt = rawText
    ? `วิเคราะห์ข้อความรายละเอียดการตั้งค่าระบบต่อไปนี้ที่ผู้ใช้พิมพ์ส่งเข้ามา:
"${rawText}"
${targetFocusInstructions}

ทำการสกัดและจัดรูปแบบข้อมูลให้อยู่ใน JSON โครงสร้างตาม schema ที่กำหนด และเขียนคำอธิบายวิเคราะห์สั้นๆ เป็นภาษาไทย`
    : `วิเคราะห์เอกสารประกอบการตั้งค่าระบบต่อไปนี้ (อาจเป็นรูปภาพ, ตาราง Excel, ใบเสนอราคา, หรือคู่มือ PDF)
${targetFocusInstructions}

ทำการสกัดและจัดรูปแบบข้อมูลให้อยู่ใน JSON โครงสร้างตาม schema ที่กำหนด และเขียนคำอธิบายวิเคราะห์สั้นๆ เป็นภาษาไทย`;

  try {
    const contents: any[] = [];
    if (base64Data && mimeType) {
      contents.push({
        inlineData: {
          mimeType,
          data: base64Data,
        },
      });
    }
    contents.push(prompt);

    const response = await generateContentWithRetry({
      model,
      contents: contents,
      config: {
        systemInstruction: `คุณเป็นผู้ดูแลระบบสกัดและวิเคราะห์เอกสารอัจฉริยะเพื่อนำเข้าข้อมูลการตั้งค่าระบบของซอฟต์แวร์ควบคุมต้นทุนงานก่อสร้าง ปฏิบัติงานด้วยความรอบคอบและสกัดเฉพาะข้อมูลที่เป็นจริงที่ตรวจพบเท่านั้น อ้างอิงตามคำสั่งที่เน้นย้ำ: ${targetFocusInstructions}`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            projects: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING, description: "ชื่อโครงการก่อสร้าง" },
                  contractBudget: { type: Type.NUMBER, description: "งบประมาณโครงการตามสัญญา (ถ้ามี)" },
                  pettyCashBudget: { type: Type.NUMBER, description: "งบประมาณเงินทดรองจ่ายหน้างาน (ถ้ามี)" },
                },
                required: ["name"],
              },
            },
            categories: {
              type: Type.ARRAY,
              items: { type: Type.STRING, description: "หมวดหมู่ค่าใช้จ่าย" },
            },
            referenceUrls: {
              type: Type.OBJECT,
              properties: {
                steelPriceUrl: { type: Type.STRING, description: "URL ราคากลางเหล็ก" },
                laborCostUrl: { type: Type.STRING, description: "URL ราคากลางค่าแรง" },
                cementPriceUrl: { type: Type.STRING, description: "URL ราคากลางปูนปลาสเตอร์หรือซีเมนต์" },
              },
            },
            documentFormats: {
              type: Type.OBJECT,
              properties: {
                employee: { type: Type.STRING },
                project: { type: Type.STRING },
                category: { type: Type.STRING },
                advance: { type: Type.STRING },
                clearing: { type: Type.STRING },
              },
            },
            docTemplate: {
              type: Type.OBJECT,
              properties: {
                companyName: { type: Type.STRING, description: "ชื่อบริษัท/องค์กร" },
                companyAddress: { type: Type.STRING, description: "ที่อยู่บริษัท" },
                companyContact: { type: Type.STRING, description: "ข้อมูลติดต่อ เช่น เบอร์โทรศัพท์ หรืออีเมล" },
                companyLogoUrl: { type: Type.STRING, description: "ลิงก์ URL รูปโลโก้บริษัท" },
              },
            },
            reasoning: { type: Type.STRING, description: "สรุปสิ่งที่ตรวจพบและแนะนำสั้นๆ เป็นภาษาไทย" },
          },
          required: ["reasoning"],
        },
      },
    });

    if (user) {
      await logAiUsage({
        userId: user.id,
        userName: user.name,
        taskType: "IMPORT",
        model,
        promptTokens: response.usageMetadata?.promptTokenCount || 0,
        completionTokens: response.usageMetadata?.candidatesTokenCount || 0
      });
    }

    const text = response.text;
    if (!text) throw new Error("No text response received from Gemini API.");
    return JSON.parse(text.trim()) as ImportSettingsResult;
  } catch (error) {
    console.error("Gemini settings import error:", error);
    throw new Error(`AI Import failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
