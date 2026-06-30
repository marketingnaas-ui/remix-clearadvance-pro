/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";

export interface DocumentFormats {
  employee: string;
  project: string;
  category: string;
  advance: string;
  clearing: string;
  clearingCheck: string;
  pettyCashSummary: string;
  clearingDoc: string;
  other: string;
}

export const DEFAULT_DOCUMENT_FORMATS: DocumentFormats = {
  employee: "EMP-{seq:4}",
  project: "PRJ-{seq:3}",
  category: "CAT-{seq:3}",
  advance: "ADV-{yy}{mm}-P{seq:3}",
  clearing: "CLR-{advId}-{roundNo}",
  clearingCheck: "RV-{advId}-{roundNo}",
  pettyCashSummary: "REP-{yy}{mm}-{seq:3}",
  clearingDoc: "DOC-{seq:4}",
  other: "OTH-{seq:3}"
};

/**
 * Generates a formatted ID based on a format pattern, sequence number, and context.
 */
export function generateFormattedId(
  pattern: string,
  seq: number,
  context?: {
    advId?: string;
    roundNo?: number;
    year?: string;
    month?: string;
  }
): string {
  const now = new Date();
  const yyyy = context?.year || String(now.getFullYear());
  const yy = yyyy.slice(-2);
  const mm = context?.month || String(now.getMonth() + 1).padStart(2, "0");

  let result = pattern;
  result = result.replace(/{yyyy}/gi, yyyy);
  result = result.replace(/{yy}/gi, yy);
  result = result.replace(/{mm}/gi, mm);
  
  if (context?.advId) {
    result = result.replace(/{advId}/gi, context.advId);
  }
  if (context?.roundNo !== undefined) {
    result = result.replace(/{roundNo}/gi, String(context.roundNo));
  }

  // Find {seq:X} (custom padding)
  const seqRegex = /{seq:(\d+)}/i;
  const match = result.match(seqRegex);
  if (match) {
    const padLen = parseInt(match[1], 10) || 3;
    const paddedSeq = String(seq).padStart(padLen, "0");
    result = result.replace(seqRegex, paddedSeq);
  } else {
    // Try simple {seq}
    result = result.replace(/{seq}/gi, String(seq));
  }

  return result;
}

/**
 * Retrieves the current document numbering formats from Firestore settings.
 */
export async function getDocumentFormats(): Promise<DocumentFormats> {
  try {
    const settingsRef = doc(db, "settings", "global");
    const snap = await getDoc(settingsRef);
    if (snap.exists()) {
      const data = snap.data();
      if (data.documentFormats) {
        return {
          ...DEFAULT_DOCUMENT_FORMATS,
          ...data.documentFormats
        };
      }
    }
  } catch (err) {
    console.error("Error fetching document formats:", err);
  }
  return DEFAULT_DOCUMENT_FORMATS;
}

/**
 * Saves document formats to Firestore.
 */
export async function saveDocumentFormats(formats: DocumentFormats): Promise<void> {
  const settingsRef = doc(db, "settings", "global");
  await setDoc(settingsRef, {
    documentFormats: formats
  }, { merge: true });
}
