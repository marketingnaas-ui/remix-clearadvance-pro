const fs = require('fs');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

async function run() {
  const firebaseConfig = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  const snap = await getDocs(collection(db, 'employees'));
  console.log(`Found ${snap.size} employees in Firestore.`);
  snap.forEach(docSnap => {
    const data = docSnap.data();
    console.log(`Employee: ${data.name} (Role: ${data.role})`);
    console.log(`- lineUserId: ${data.lineUserId || 'None'}`);
    console.log(`- isActive: ${data.isActive}`);
  });
}

run().catch(console.error);
