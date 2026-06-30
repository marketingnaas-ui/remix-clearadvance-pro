import * as XLSX from 'xlsx';

/**
 * Sanitizes a cell value to prevent Excel crashes due to character limits.
 * Truncates values to be safely below Excel's 32,767 character limit.
 * Detects and placeholder-replaces raw base64 data to keep sheet clean.
 */
function sanitizeValue(val: any): any {
  if (val === null || val === undefined) {
    return "";
  }

  // Handle Date objects
  if (val instanceof Date) {
    return val;
  }

  if (typeof val === 'string') {
    // Detect and replace base64 data URIs
    if (val.startsWith('data:')) {
      return "[Base64 Media/Image Data]";
    }
    
    // Detect long raw base64 encoded strings without spaces (e.g. signature base64, raw slip data)
    if (val.length > 500 && !val.includes(' ') && !val.includes('-') && /^[A-Za-z0-9+/=]+$/.test(val)) {
      return "[Base64 Encoded Data]";
    }

    // Enforce Excel's maximum string length per cell (32,767 characters)
    if (val.length > 32700) {
      return val.substring(0, 32700) + " ... [TRUNCATED]";
    }
    
    return val;
  }

  // Handle nested objects or arrays by serializing them
  if (typeof val === 'object') {
    try {
      const str = JSON.stringify(val);
      if (str.length > 32700) {
        return str.substring(0, 32700) + " ... [TRUNCATED]";
      }
      return str;
    } catch (e) {
      return "[Complex Object]";
    }
  }

  return val;
}

/**
 * Exports an array of objects to an Excel file.
 * @param data Array of objects to export
 * @param fileName Name of the file (without extension)
 * @param sheetName Name of the sheet
 */
export function exportToExcel(data: any[], fileName: string = 'export', sheetName: string = 'Sheet1') {
  if (!data || data.length === 0) {
    console.warn("No data provided for Excel export");
    return;
  }

  // Sanitize data to avoid xlsx throwing "Text length must not exceed 32767 characters"
  const sanitizedData = data.map(row => {
    if (!row || typeof row !== 'object') {
      return row;
    }
    const cleanRow: any = {};
    for (const key of Object.keys(row)) {
      cleanRow[key] = sanitizeValue(row[key]);
    }
    return cleanRow;
  });

  // Create a worksheet from the sanitized data
  const worksheet = XLSX.utils.json_to_sheet(sanitizedData);
  
  // Create a new workbook
  const workbook = XLSX.utils.book_new();
  
  // Append the worksheet to the workbook
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  
  // Generate the Excel file and trigger a download
  XLSX.writeFile(workbook, `${fileName}.xlsx`);
}
