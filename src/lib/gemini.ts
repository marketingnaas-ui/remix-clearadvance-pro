/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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

/**
 * Process receipt image using server-side Gemini API OCR route
 * @param base64Data Base64 representation of the image file (excluding metadata header)
 * @param mimeType Image MIME type (e.g. image/jpeg, image/png)
 */
export async function performAIOCR(
  base64Data: string, 
  mimeType: string, 
  user?: { id: string; name: string }
): Promise<OCRResult> {
  try {
    const response = await fetch("/api/gemini/ocr", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ base64Data, mimeType, user }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody.error || `Server responded with status ${response.status}`);
    }

    const resJson = await response.json();
    if (resJson.status === "success" && resJson.data) {
      return resJson.data as OCRResult;
    } else {
      throw new Error(resJson.error || "Invalid response format from server.");
    }
  } catch (error) {
    console.error("Client-side OCR Fetch Error:", error);
    throw new Error(`AI Scan failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
