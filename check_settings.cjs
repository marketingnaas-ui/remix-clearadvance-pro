const { initializeApp } = require("firebase/app");
const { getFirestore, doc, getDoc } = require("firebase/firestore");
const fs = require("fs");

const firebaseConfig = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf-8"));
const app = initializeApp(firebaseConfig);
const dbId = firebaseConfig.firestoreDatabaseId;
const db = dbId ? getFirestore(app, dbId) : getFirestore(app);

async function main() {
  const docRef = doc(db, "settings", "global");
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    const data = docSnap.data();
    console.log("lineConfig:", JSON.stringify(data.lineConfig, null, 2));
  } else {
    console.log("No global settings found.");
  }
}
main().catch(console.error).then(() => process.exit(0));
