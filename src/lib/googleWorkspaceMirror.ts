const postJson = async (url: string, payload: any = {}) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  const data = (() => {
    try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
  })();
  if (!response.ok) {
    const error: any = new Error(data?.error || text || `Request failed: ${url}`);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
};

export async function testAppsScriptConnection() {
  return postJson("/api/google-workspace/test-connection");
}

export async function syncCollectionToGoogleSheet(collectionName: string) {
  return postJson("/api/google-workspace/sync-collection", { collectionName });
}

export async function syncFullFirestoreToGoogleSheet() {
  return postJson("/api/google-workspace/sync-all");
}

export async function syncAdvanceBundleToGoogleWorkspace(advId: string) {
  return postJson("/api/google-workspace/sync-advance-bundle", { advId });
}

export async function syncClearanceBundleToGoogleWorkspace(clrId: string) {
  return postJson("/api/google-workspace/sync-clearance-bundle", { clrId });
}

export async function saveFilesToGoogleDrive(payload: any) {
  return postJson("/api/google-workspace/save-files", payload);
}

export async function refreshGoogleSheetReports() {
  return postJson("/api/google-workspace/refresh-reports");
}

export async function retryFailedGoogleWorkspaceSync(logId: string) {
  return postJson("/api/google-workspace/retry-failed-sync", { logId });
}
