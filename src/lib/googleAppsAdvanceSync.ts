export interface GoogleAppsAdvanceMirrorConfig {
  appsScriptWebAppUrl?: string;
  appsScriptApiKey?: string;
  mirrorAdvancesEnabled?: boolean;
  mirrorVaultFilesEnabled?: boolean;
}

export interface MirrorAdvancePayload {
  advance: Record<string, any>;
  vaultFile?: Record<string, any> | null;
  file?: {
    fileName: string;
    mimeType: string;
    base64: string;
    fileSize?: number;
  } | null;
}

function normalizeBase64(dataUrlOrBase64: string) {
  const match = dataUrlOrBase64.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return {
      mimeType: match[1],
      base64: match[2],
    };
  }

  return {
    mimeType: "application/octet-stream",
    base64: dataUrlOrBase64,
  };
}

export function buildMirrorFileFromDataUrl(fileName: string, dataUrlOrBase64: string, fileSize?: number) {
  const normalized = normalizeBase64(dataUrlOrBase64);
  return {
    fileName,
    mimeType: normalized.mimeType,
    base64: normalized.base64,
    fileSize,
  };
}

export async function buildMirrorFileFromBrowserFile(file: File) {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file for Google Apps Script sync"));
    reader.readAsDataURL(file);
  });

  return buildMirrorFileFromDataUrl(file.name, base64, file.size);
}

export async function mirrorAdvanceToGoogleAppsScript(
  config: GoogleAppsAdvanceMirrorConfig | undefined,
  payload: MirrorAdvancePayload
) {
  if (!config?.appsScriptWebAppUrl) return { skipped: true, reason: "missing_web_app_url" };
  if (config.mirrorAdvancesEnabled === false && config.mirrorVaultFilesEnabled === false) {
    return { skipped: true, reason: "sync_disabled" };
  }

  const response = await fetch("/api/google-workspace/advance-sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      config,
      payload,
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}
