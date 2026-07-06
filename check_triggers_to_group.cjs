const fs = require('fs');
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc } = require('firebase/firestore');

async function run() {
  const firebaseConfig = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
  if (!settingsSnap.exists()) {
    console.log('No settings doc');
    return;
  }
  const config = settingsSnap.data().lineMessagingConfig || {};
  const triggers = config.triggers || [];
  console.log('enableGroupNotification:', config.enableGroupNotification);
  console.log('groupId:', config.groupId);
  console.log('lineGroupId:', config.lineGroupId);

  triggers.forEach(t => {
    console.log(`Trigger ID: ${t.id}`);
    console.log(`- isActive: ${t.isActive}`);
    console.log(`- sendToUsers: ${t.sendToUsers}`);
    console.log(`- sendToGroup: ${t.sendToGroup}`);
    console.log(`- recipientMode: ${t.recipientMode}`);
    console.log(`- recipientRoles:`, t.recipientRoles);
  });
}

run().catch(console.error);
