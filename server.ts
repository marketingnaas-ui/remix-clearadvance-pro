import express from "express";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { performServerAIOCR } from "./src/server/gemini";
import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import multer from "multer";

dotenv.config();

let bucket: any = null;
let firestoreDb: any = null;
let adminAppInstance: any = null;

let firebaseConfig: any = {};
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  }
} catch (e) {
  console.error("Failed to read firebase-applet-config.json in server.ts:", e);
}

// Initialize Firebase Admin gracefully
try {
  const hasAdminCredentials = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_CONFIG);
  if (!hasAdminCredentials) {
    throw new Error("Firebase Admin credentials are not configured. Server-side admin APIs will be disabled.");
  }
  const apps = getApps();
  let adminApp: any;
  if (!apps.length) {
    adminApp = initializeApp({
      credential: applicationDefault(),
      projectId: firebaseConfig.projectId || "gen-lang-client-0100804557",
      storageBucket: firebaseConfig.storageBucket || "gen-lang-client-0100804557.firebasestorage.app"
    });
  } else {
    adminApp = apps[0];
  }
  adminAppInstance = adminApp;
  bucket = getStorage(adminApp).bucket();
  
  const dbId = firebaseConfig.firestoreDatabaseId || "ai-studio-remixclearadvanc-17d5f5ae-d1c1-4457-bef4-365e55fd21aa";
  firestoreDb = getFirestore(adminApp, dbId);

  // Asynchronously verify connection and fallback to default database if named database does not exist
  (async () => {
    try {
      await firestoreDb.collection("test").doc("connection").get();
      console.log(`Firebase Admin successfully connected to database: ${dbId}`);
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      if (errMsg.includes("NOT_FOUND") || errMsg.includes("not found") || err?.code === 5) {
        console.warn(`Database ID "${dbId}" not found on server side. Falling back to default database "(default)".`);
        firestoreDb = getFirestore(adminApp);
      } else {
        console.warn("Firebase Admin connection check failed. Server-side admin APIs will be disabled:", errMsg);
        firestoreDb = null;
        bucket = null;
      }
    }
  })().catch((err) => {
    console.warn("Firebase Admin async initialization failed. Server-side admin APIs will be disabled:", err?.message || err);
    firestoreDb = null;
    bucket = null;
  });
} catch (e) {
  console.warn("Firebase Admin initialization skipped. Server will run without cloud storage uploads/admin Firestore APIs:", e);
  firestoreDb = null;
  bucket = null;
}

// Local directory for storing profile photos to bypass Cloud Storage permission issues
const PROFILES_DIR = path.join(process.cwd(), "profiles");
if (!fs.existsSync(PROFILES_DIR)) {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
}

const upload = multer({ storage: multer.memoryStorage() });

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  // Use JSON middleware with 20MB limit for base64 file uploads
  app.use(express.json({ limit: "20mb" }));

  // API Route for profile image upload (Bypassing Firebase Storage 403 using local storage)
  app.post("/api/upload-profile-image", (req, res, next) => {
    console.log("POST /api/upload-profile-image route started");
    next();
  }, upload.single("image"), async (req, res) => {
    try {
      console.log("upload.single('image') executed");
      const { employeeId } = req.body;
      console.log("employeeId in body:", employeeId);
      console.log("req.file:", req.file ? { originalname: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype } : "undefined");
      
      if (!req.file || !employeeId) {
          return res.status(400).json({ error: "Missing file or employeeId" });
      }
      
      const file = req.file;
      const extension = path.extname(file.originalname) || ".jpg";
      const filename = `${Date.now()}${extension}`;
      
      // Ensure specific employee folder exists
      const empDir = path.join(PROFILES_DIR, employeeId);
      if (!fs.existsSync(empDir)) {
        fs.mkdirSync(empDir, { recursive: true });
      }
      
      // Save file to local directory
      const filePath = path.join(empDir, filename);
      fs.writeFileSync(filePath, file.buffer);
      
      // Construct local relative download URL
      const downloadURL = `/api/profiles/${employeeId}/${filename}`;
      
      if (firestoreDb) {
        try {
          await firestoreDb.collection("employees").doc(employeeId).update({
              profilePhotoURL: downloadURL,
              profilePhotoUpdatedAt: FieldValue.serverTimestamp()
          });
        } catch (fsErr: any) {
          console.warn("Skipping server-side Firestore update (falling back to client-side write):", fsErr.message);
        }
      }
      
      res.json({ status: "success", downloadURL });
    } catch (err: any) {
      console.error("Local profile photo upload error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // API Route to serve uploaded profile images
  app.get("/api/profiles/:employeeId/:filename", (req, res) => {
    try {
      const { employeeId, filename } = req.params;
      const filePath = path.resolve(PROFILES_DIR, employeeId, filename);
      
      // Security check to avoid path traversal vulnerabilities
      if (!filePath.startsWith(PROFILES_DIR)) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filename).toLowerCase();
        let contentType = "image/jpeg";
        if (ext === ".png") contentType = "image/png";
        else if (ext === ".webp") contentType = "image/webp";
        else if (ext === ".gif") contentType = "image/gif";
        
        res.setHeader("Content-Type", contentType);
        res.sendFile(filePath);
      } else {
        res.status(404).send("Profile image not found");
      }
    } catch (err: any) {
      console.error("Error serving profile photo:", err);
      res.status(500).send("Internal server error");
    }
  });

  // API Route for Gemini OCR
  app.post("/api/gemini/ocr", async (req, res) => {
    try {
      const { base64Data, mimeType, user } = req.body;
      if (!base64Data || !mimeType) {
        return res.status(400).json({ error: "Missing base64Data or mimeType in request body." });
      }

      const result = await performServerAIOCR(base64Data, mimeType, user);
      return res.json({ status: "success", data: result });
    } catch (err: any) {
      console.error("Server API OCR Error:", err);
      return res.status(500).json({ error: err?.message || "Internal server error during OCR parsing." });
    }
  });

  // API Route for Prince Advance Chatbot
  app.post("/api/gemini/chat", async (req, res) => {
    try {
      const { message, chatHistory, databaseContext, user } = req.body;
      if (!message || !chatHistory || !databaseContext) {
        return res.status(400).json({ error: "Missing message, chatHistory, or databaseContext." });
      }

      const { queryPrinceAdvanceAI } = await import("./src/server/gemini");
      const reply = await queryPrinceAdvanceAI({ message, chatHistory, databaseContext }, user);
      return res.json({ status: "success", reply });
    } catch (err: any) {
      console.error("Server API Chat Error:", err);
      return res.status(500).json({ error: err?.message || "Internal server error during Chat processing." });
    }
  });

  // API Route for Project Petty Cash Budget Estimation
  app.post("/api/gemini/estimate-budget", async (req, res) => {
    try {
      const { totalContractBudget, user } = req.body;
      if (typeof totalContractBudget !== "number") {
        return res.status(400).json({ error: "Invalid or missing totalContractBudget." });
      }

      const { estimatePettyCashBudget } = await import("./src/server/gemini");
      const result = await estimatePettyCashBudget(totalContractBudget, user);
      return res.json({ status: "success", data: result });
    } catch (err: any) {
      console.error("Server API Estimate Budget Error:", err);
      return res.status(500).json({ error: err?.message || "Internal server error during budget estimation." });
    }
  });

  // API Route for AI Settings Document Import
  app.post("/api/gemini/import-settings", async (req, res) => {
    try {
      const { base64Data, mimeType, rawText, targetTab, user } = req.body;
      if (!base64Data && !rawText) {
        return res.status(400).json({ error: "Missing both base64Data and rawText." });
      }

      const { importSettingsFromDocument } = await import("./src/server/gemini");
      const result = await importSettingsFromDocument(base64Data, mimeType, rawText, targetTab, user);
      return res.json({ status: "success", data: result });
    } catch (err: any) {
      console.error("Server API Import Settings Error:", err);
      return res.status(500).json({ error: err?.message || "Internal server error during settings import." });
    }
  });

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // API Route for LINE Notifications using real LINE Messaging API
  app.post("/api/line/send-notification", async (req, res) => {
    try {
      const { triggerId, variables, targetEmployeeId } = req.body;
      if (!triggerId || !variables) {
        return res.status(400).json({ error: "Missing triggerId or variables in request body." });
      }

      console.log(`Sending LINE Notification for trigger "${triggerId}"...`);

      if (!firestoreDb) {
        return res.status(500).json({ error: "Firestore DB is not initialized on the server." });
      }

      // Helper function to replace template placeholders
      const replaceVariables = (template: string, vars: Record<string, any>): string => {
        let result = template;
        for (const [key, val] of Object.entries(vars)) {
          result = result.replace(new RegExp(`{${key}}`, "g"), String(val ?? ""));
        }
        return result;
      };

      // Helper function to replace variables in an object structure (for Flex JSON)
      const replaceVariablesInObject = (obj: any, vars: Record<string, any>): any => {
        if (typeof obj === "string") {
          return replaceVariables(obj, vars);
        }
        if (Array.isArray(obj)) {
          return obj.map(item => replaceVariablesInObject(item, vars));
        }
        if (obj !== null && typeof obj === "object") {
          const newObj: any = {};
          for (const [key, value] of Object.entries(obj)) {
            newObj[key] = replaceVariablesInObject(value, vars);
          }
          return newObj;
        }
        return obj;
      };

      // 1. Get LINE Messaging config from settings/global
      const settingsSnap = await firestoreDb.collection("settings").doc("global").get();
      if (!settingsSnap.exists) {
        return res.status(404).json({ error: "Global settings document not found." });
      }

      const settingsData = settingsSnap.data();
      const lineConfig = settingsData.lineMessagingConfig;

      if (!lineConfig || !lineConfig.channelAccessToken) {
        console.warn("LINE Notifications are not configured yet (no Channel Access Token).");
        return res.json({ status: "skipped", message: "LINE Messaging is not configured. Config is empty." });
      }

      const channelAccessToken = lineConfig.channelAccessToken;
      const triggers = lineConfig.triggers || [];
      const trigger = triggers.find((t: any) => t.id === triggerId);

      if (!trigger) {
        console.warn(`No trigger found for ID: ${triggerId}`);
        return res.json({ status: "skipped", message: `No trigger found for ID: ${triggerId}` });
      }

      if (!trigger.isActive) {
        console.log(`Trigger "${triggerId}" is inactive. Skipping notification.`);
        return res.json({ status: "skipped", message: `Trigger "${triggerId}" is inactive.` });
      }

      // 2. Fetch recipients (lineUserIds) from employees in memory (safest, no composite indices needed)
      const recipientIdsSet = new Set<string>();
      const empSnap = await firestoreDb.collection("employees").get();
      const allEmployees: any[] = [];
      empSnap.forEach((docSnap: any) => {
        allEmployees.push({ id: docSnap.id, ...docSnap.data() });
      });

      // Target criteria based on trigger type
      if (triggerId === "onNewRequest") {
        // Notify managers, administrators, and accounting team
        allEmployees.forEach(emp => {
          if (emp.lineUserId && (emp.role === "Manager" || emp.role === "Admin" || emp.role === "Accountant" || emp.role === "Accounting")) {
            recipientIdsSet.add(emp.lineUserId);
          }
        });
      } else if (triggerId === "onManagerApproval") {
        // Notify the requester and accounting/admin teams
        allEmployees.forEach(emp => {
          if (emp.lineUserId) {
            if (emp.id === targetEmployeeId || emp.role === "Accountant" || emp.role === "Accounting" || emp.role === "Admin") {
              recipientIdsSet.add(emp.lineUserId);
            }
          }
        });
      } else if (triggerId === "onClearanceSubmitted") {
        // Notify managers, administrators, and accounting team
        allEmployees.forEach(emp => {
          if (emp.lineUserId && (emp.role === "Manager" || emp.role === "Admin" || emp.role === "Accountant" || emp.role === "Accounting")) {
            recipientIdsSet.add(emp.lineUserId);
          }
        });
      } else if (triggerId === "onSettlement") {
        // Notify the requester
        allEmployees.forEach(emp => {
          if (emp.lineUserId) {
            if (emp.id === targetEmployeeId || emp.role === "Admin") {
              recipientIdsSet.add(emp.lineUserId);
            }
          }
        });
      } else {
        // Default: If specific targetEmployeeId provided, notify them
        if (targetEmployeeId) {
          const targetEmp = allEmployees.find(emp => emp.id === targetEmployeeId);
          if (targetEmp?.lineUserId) {
            recipientIdsSet.add(targetEmp.lineUserId);
          }
        }
      }

      const recipients = Array.from(recipientIdsSet);
      if (recipients.length === 0) {
        console.log("No recipients found with a registered LINE User ID.");
        return res.json({ status: "skipped", message: "No employees have a registered LINE User ID." });
      }

      // 3. Format Message
      let messagePayload: any = null;

      if (trigger.type === "flex") {
        try {
          // Parse string template to JSON
          let templateJson = trigger.messageTemplate;
          if (typeof templateJson === "string") {
            try {
              templateJson = JSON.parse(templateJson);
            } catch {
              // It was just a raw string, not a valid stringified JSON
            }
          }
          const resolvedJson = replaceVariablesInObject(templateJson, variables);
          messagePayload = {
            type: "flex",
            altText: "ClearAdvance PRO แจ้งเตือนสถานะใบเบิกเงิน",
            contents: resolvedJson
          };
        } catch (jsonErr: any) {
          console.error("Failed to parse or resolve Flex Message JSON template:", jsonErr);
          // Fallback to text message
          const textMsg = replaceVariables(trigger.messageTemplate, variables);
          messagePayload = {
            type: "text",
            text: `[Flex Template Parse Error. Fallback Text]\n\n${textMsg}`
          };
        }
      } else {
        // Default to Text
        const textMsg = replaceVariables(trigger.messageTemplate, variables);
        messagePayload = {
          type: "text",
          text: textMsg
        };
      }

      // 4. Send messages to LINE Messaging API
      const results: any[] = [];
      for (const userId of recipients) {
        try {
          const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${channelAccessToken}`
            },
            body: JSON.stringify({
              to: userId,
              messages: [messagePayload]
            })
          });

          const resText = await lineRes.text();
          console.log(`LINE API response for ${userId}:`, lineRes.status, resText);
          results.push({ userId, status: lineRes.status, response: resText });
        } catch (fetchErr: any) {
          console.error(`Fetch error sending to LINE user ${userId}:`, fetchErr);
          results.push({ userId, status: "error", error: fetchErr.message });
        }
      }

      return res.json({ status: "success", recipientsSent: recipients.length, results });
    } catch (err: any) {
      console.error("Send LINE Notification error:", err);
      return res.status(500).json({ error: err.message || "Internal server error during notification dispatch." });
    }
  });

  // API Route for Google OAuth Token (Placeholder for Workspace Sync)
  app.get("/api/oauth/token", (req, res) => {
    // In this environment, the token is typically managed via Firebase Auth on the client.
    // This endpoint acts as a bridge or placeholder.
    // If a specific GOOGLE_ACCESS_TOKEN was provided in env, return it.
    const token = process.env.GOOGLE_ACCESS_TOKEN || null;
    res.json({ access_token: token });
  });

  // API Route for Google Picker Configuration
  app.get("/api/oauth/picker-config", (req, res) => {
    res.json({
      apiKey: process.env.GOOGLE_PICKER_API_KEY || "",
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID || "",
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.VITE_GOOGLE_OAUTH_CLIENT_ID || ""
    });
  });

  // 404 handler for unmatched API routes to prevent falling through to Vite/SPA index.html
  app.use("/api", (req, res, next) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
  });

  // Global Error Handler to return JSON instead of HTML on error for all API requests
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Global Error caught in server.ts:", err);
    if (req.originalUrl && req.originalUrl.startsWith("/api")) {
      return res.status(err.status || 500).json({ 
        status: "error", 
        error: err.message || "Internal Server Error" 
      });
    }
    next(err);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
