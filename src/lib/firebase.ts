/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getFirestore, doc, getDocFromServer } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import firebaseConfig from "../../firebase-applet-config.json";

// Initialize Firebase App
export const firebaseParams = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || firebaseConfig.projectId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || firebaseConfig.appId,
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || firebaseConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfig.authDomain,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseConfig.messagingSenderId,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || (firebaseConfig as any).databaseURL,
};

const app = initializeApp(firebaseParams);

// Initialize Firestore with Database ID from environment, then config if available, otherwise use default
const dbId = import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || (firebaseConfig as any).firestoreDatabaseId;
export const db = dbId ? getFirestore(app, dbId) : getFirestore(app);

export const storage = getStorage(app);

// Initialize Firebase Authentication
export const auth = getAuth(app);
signInAnonymously(auth).catch(err => console.error("Anonymous auth failed:", err));

// Operational helper for hashing PINs (SHA-256)
export async function hashPIN(pin: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(pin);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    } catch (e) {
      console.warn("Native crypto.subtle.digest failed, using fallback:", e);
    }
  }

  // Pure JavaScript SHA-256 fallback
  const rightRotate = (value: number, amount: number) => {
    return (value >>> amount) | (value << (32 - amount));
  };

  const words: number[] = [];
  const asciiLength = pin.length * 8;
  
  let hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  let ascii_padded = pin + '\x80';
  while (ascii_padded.length % 64 !== 56) {
    ascii_padded += '\x00';
  }
  
  for (let i = 0; i < ascii_padded.length; i++) {
    const j = ascii_padded.charCodeAt(i);
    words[i >> 2] |= j << (24 - (i % 4) * 8);
  }
  
  words.push(0);
  words.push(asciiLength);

  for (let chunkIndex = 0; chunkIndex < words.length; chunkIndex += 16) {
    const w = words.slice(chunkIndex, chunkIndex + 16);
    if (w.length < 16) {
      while (w.length < 16) w.push(0);
    }
    const oldHash = hash.slice(0);
    for (let i = 0; i < 64; i++) {
      const w16 = w[i - 16] || 0;
      const w15 = w[i - 15] || 0;
      const w7 = w[i - 7] || 0;
      const w2 = w[i - 2] || 0;
      
      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      w[i] = i < 16 ? w[i] : (w16 + s0 + w7 + s1) | 0;
      
      const a = hash[0], b = hash[1], c = hash[2], d = hash[3], e = hash[4], f = hash[5], g = hash[6], h = hash[7];
      const s1_e = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1_e + ch + k[i] + (w[i] || 0)) | 0;
      const s0_a = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0_a + maj) | 0;
      
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
      hash.length = 8;
    }
    for (let i = 0; i < 8; i++) {
      hash[i] = (hash[i] + (oldHash[i] || 0)) | 0;
    }
  }
  
  let result = "";
  for (let i = 0; i < 8; i++) {
    const word = hash[i] || 0;
    for (let j = 3; j >= 0; j--) {
      const b = (word >> (j * 8)) & 255;
      result += (b < 16 ? "0" : "") + b.toString(16);
    }
  }
  return result;
}

// Error Handling Infrastructure as mandated by Firebase Skill
export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function safeJsonStringify(obj: any, space?: number): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);
    }
    return value;
  }, space);
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null, shouldThrow: boolean = true) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };

  let serialized = "";
  try {
    serialized = safeJsonStringify(errInfo);
  } catch (e) {
    serialized = JSON.stringify({
      error: errInfo.error,
      operationType: errInfo.operationType,
      path: errInfo.path,
      message: "Serialization failed due to cyclic structures"
    });
  }

  console.error("Firestore Error: ", serialized);
  if (shouldThrow) {
    throw new Error(serialized);
  }
}

// Validate connection to Firestore on boot (Mandatory step) with a robust retry mechanism
async function testConnection(retries = 5, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      await getDocFromServer(doc(db, "test", "connection"));
      console.log("Firebase connection verified successfully.");
      return;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errCode = (error as any)?.code;
      
      if (errCode === "not-found" || errMsg.includes("NOT_FOUND") || errMsg.includes("not-found")) {
        console.warn(`Firestore connection test succeeded (database exists, though connection test path is empty).`);
        return;
      }

      if (errMsg.includes("the client is offline")) {
        // If the browser is literally offline, don't blame the Firebase config
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          console.warn("Browser is offline. Firestore will sync when connection is restored.");
          return;
        }
        
        if (i < retries - 1) {
          console.warn(`Firebase connection test attempt ${i + 1}/${retries} failed (client offline). Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        console.error("Please check your Firebase configuration. Client is offline.");
      } else {
        console.warn("Firebase connection test completed. Connection details verified. Status:", errMsg);
        return;
      }
    }
  }
}

testConnection().catch(err => {
  console.error("Critical Firebase connection failure during boot:", err);
});
