const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// We need to inject LineAccountLinker import
if (!content.includes('LineAccountLinker')) {
  content = content.replace('import PinLogin from "./components/PinLogin";', 'import PinLogin from "./components/PinLogin";\nimport LineAccountLinker from "./components/LineAccountLinker";');
}

// Replace initLiffAutoSession
const liffLogic = `
  const [liffState, setLiffState] = React.useState<"loading" | "linked" | "not_linked" | "not_liff">("loading");
  const [liffProfileContext, setLiffProfileContext] = React.useState<any>(null);

  React.useEffect(() => {
    const initLiffSystem = async () => {
      try {
        const pathname = window.location.pathname;
        const search = new URLSearchParams(window.location.search);
        const hasSavedLiffParams = 
          sessionStorage.getItem("liff_param_route") ||
          sessionStorage.getItem("liff_param_action") ||
          sessionStorage.getItem("liff_param_adv_id") ||
          sessionStorage.getItem("liff_param_advId") ||
          sessionStorage.getItem("liff_param_id") ||
          sessionStorage.getItem("liff_param_docId") ||
          sessionStorage.getItem("liff_param_documentId");

        const isLineRuntime =
          /Line/i.test(navigator.userAgent) ||
          pathname.startsWith("/liff") ||
          search.has("liff.state") ||
          search.has("liff.referrer") ||
          search.has("adv_id") ||
          search.has("advId") ||
          search.has("action") ||
          Boolean(hasSavedLiffParams);

        if (!isLineRuntime) {
          setLiffState("not_liff");
          return;
        }

        const settingsSnap = await getDoc(doc(db, "settings", "global"));
        if (!settingsSnap.exists()) {
           setLiffState("not_liff");
           return;
        }
        
        const settingsData = settingsSnap.data();
        const lId = settingsData?.lineMessagingConfig?.liffId || settingsData?.lineConfig?.liffId;

        if (lId && lId !== "123456-abcde") {
          const liff = (await import("@line/liff")).default;
          if (!liff.id) {
            await liff.init({ liffId: lId });
          }
          if (!liff.isLoggedIn()) {
             const isInIframe = window.self !== window.top;
             if (!isInIframe) {
                liff.login();
                return;
             } else {
                setLiffState("not_liff");
                return;
             }
          }

          const profile = await liff.getProfile();
          setLiffProfileContext(profile);

          if (profile?.userId) {
            const empQuery = query(
              collection(db, "employees"),
              where("lineUserId", "==", profile.userId),
              limit(1)
            );
            const empSnap = await getDocs(empQuery);
            if (!empSnap.empty) {
              const matchedEmp = { id: empSnap.docs[0].id, ...empSnap.docs[0].data() } as Employee;
              if (matchedEmp.isActive !== false && matchedEmp.status !== "Suspended" && matchedEmp.status !== "Disabled") {
                setCurrentEmployee(matchedEmp);
                setLiffState("linked");
              } else {
                setLiffState("not_linked");
              }
            } else {
              setLiffState("not_linked");
            }
          } else {
             setLiffState("not_linked");
          }
        } else {
           setLiffState("not_liff");
        }
      } catch (err) {
        console.warn("Background LIFF session check failed:", err);
        setLiffState("not_liff");
      }
    };
    
    initLiffSystem();
  }, []);
`;

// regex to replace initLiffAutoSession block
content = content.replace(/\/\/ LINE LIFF automatic session switching([\s\S]*?)\]\);\n\n  \/\/ Get mobile navigation items/m, liffLogic + '\n\n  // Get mobile navigation items');

fs.writeFileSync('src/App.tsx', content);
