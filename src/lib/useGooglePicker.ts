import { useState, useCallback, useEffect } from "react";
import { fetchAccessToken, requestGoogleAccessToken } from "./workspaceSync";

interface PickerResult {
  id: string;
  url: string;
  name: string;
  mimeType: string;
}

export function useGooglePicker() {
  const [isPickerLoaded, setIsPickerLoaded] = useState(false);
  const [pickerConfig, setPickerConfig] = useState<{ apiKey: string; projectId: string; clientId?: string } | null>(null);
  
  useEffect(() => {
    // Load config
    fetch("/api/oauth/picker-config")
      .then(r => r.json())
      .then(config => setPickerConfig(config))
      .catch(e => console.error("Failed to load picker config", e));

    // Load Picker script
    const loadScript = () => {
      const script = document.createElement("script");
      script.src = "https://apis.google.com/js/api.js";
      script.onload = () => {
        (window as any).gapi.load("picker", { callback: () => setIsPickerLoaded(true) });
      };
      document.body.appendChild(script);
    };
    
    if (!(window as any).google?.picker) {
      loadScript();
    } else {
      setIsPickerLoaded(true);
    }
  }, []);

  const openPicker = useCallback(
    (
      viewTypes: "spreadsheet" | "folder" | "all" = "all",
      onSelect: (result: PickerResult) => void
    ) => {
      if (!isPickerLoaded || !pickerConfig) {
        alert("Google Picker is not ready yet.");
        return;
      }

      fetchAccessToken().then(async (token) => {
        if (!token) {
          token = await requestGoogleAccessToken();
          if (!token) {
            alert("ไม่พบ Token ล่าสุด กรุณาอนุมัติสิทธิ์ Google Workspace ก่อน");
            return;
          }
        }

        const google = (window as any).google;
        
        let view = new google.picker.DocsView();
        if (viewTypes === "spreadsheet") {
          view.setMimeTypes("application/vnd.google-apps.spreadsheet");
        } else if (viewTypes === "folder") {
          view.setMimeTypes("application/vnd.google-apps.folder");
          view.setIncludeFolders(true);
          view.setSelectFolderEnabled(true);
        } else {
          view.setIncludeFolders(true);
        }

        const picker = new google.picker.PickerBuilder()
          .addView(view)
          .setOAuthToken(token)
          .setDeveloperKey(pickerConfig.apiKey)
          .setOrigin(window.location.protocol + '//' + window.location.host)
          .setCallback((data: any) => {
            if (data.action === google.picker.Action.PICKED) {
              const doc = data.docs[0];
              onSelect({
                id: doc.id,
                url: doc.url,
                name: doc.name,
                mimeType: doc.mimeType,
              });
            }
          })
          .build();

        picker.setVisible(true);
      }).catch(err => {
        console.error("Error fetching active access token for Picker:", err);
      });
    },
    [isPickerLoaded, pickerConfig]
  );

  return { openPicker, isPickerLoaded };
}
