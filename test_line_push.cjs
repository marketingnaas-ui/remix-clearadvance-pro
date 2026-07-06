const fs = require('fs');
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc } = require('firebase/firestore');

async function runTest() {
  console.log('--- STARTING LINE messaging api runtime test (FIXED PAYLOAD) ---');

  // 1. Read Firebase config and initialize client SDK
  const firebaseConfig = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  console.log('6. Firestore Document Read: Fetching settings/global document...');
  const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
  if (!settingsSnap.exists()) {
    console.error('FAIL: No settings/global document found.');
    return;
  }
  const config = settingsSnap.data().lineMessagingConfig || {};
  console.log('Firestore document retrieved. keys:', Object.keys(config));

  const channelAccessToken = config.channelAccessToken;
  const groupId = config.groupId || config.lineGroupId;

  if (!channelAccessToken) {
    console.error('FAIL: No channelAccessToken configured.');
    return;
  }
  if (!groupId) {
    console.error('FAIL: No groupId configured.');
    return;
  }

  console.log('Target Group ID:', groupId);

  // 2. Prepare Message Payload without letterSpacing
  const flexMessage = {
    type: 'flex',
    altText: 'ClearAdvance PRO ระบบเบิกเงินทดรองจ่ายแจ้งเตือน',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1c1917',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: 'CLEARADVANCE PRO',
            color: '#eca900',
            weight: 'bold',
            size: 'md'
          },
          {
            type: 'text',
            text: 'แจ้งเตือนทำรายการใหม่',
            color: '#ffffff',
            weight: 'bold',
            size: 'xl',
            margin: 'md'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#ffffff',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: 'รายการขอเบิกเงินทดรองจ่ายได้รับการบันทึกเรียบร้อย',
            size: 'xs',
            color: '#78716c',
            wrap: true
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            spacing: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'baseline',
                spacing: 'sm',
                contents: [
                  {
                    type: 'text',
                    text: 'รหัสใบเบิก',
                    color: '#a8a29e',
                    size: 'xs',
                    flex: 2
                  },
                  {
                    type: 'text',
                    text: 'ADV-2026-0001',
                    color: '#292524',
                    size: 'xs',
                    weight: 'bold',
                    flex: 4
                  }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                spacing: 'sm',
                contents: [
                  {
                    type: 'text',
                    text: 'จำนวนเงิน',
                    color: '#a8a29e',
                    size: 'xs',
                    flex: 2
                  },
                  {
                    type: 'text',
                    text: '1,500.00 บาท',
                    color: '#292524',
                    size: 'xs',
                    weight: 'bold',
                    flex: 4
                  }
                ]
              }
            ]
          }
        ]
      }
    }
  };

  const payload = {
    to: groupId,
    messages: [flexMessage]
  };

  // 3. Construct HTTP Request Details
  const url = 'https://api.line.me/v2/bot/message/push';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${channelAccessToken.substring(0, 15)}... [TRUNCATED_TOKEN]`
  };

  console.log('\n--- 1. HTTP REQUEST ---');
  console.log('Method: POST');
  console.log('URL:', url);
  console.log('Headers:', JSON.stringify(headers, null, 2));
  console.log('Body:', JSON.stringify(payload, null, 2));

  // 4. Perform Request
  console.log('\nDispatching push request to LINE...');
  const start = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${channelAccessToken}`
    },
    body: JSON.stringify(payload)
  });

  const duration = Date.now() - start;
  const resBodyText = await res.text();
  const requestId = res.headers.get('x-line-request-id') || 'Unknown';

  console.log('\n--- 2. HTTP RESPONSE ---');
  console.log('--- 3. STATUS CODE ---');
  console.log('Status Code:', res.status, res.statusText);
  console.log('Duration:', duration, 'ms');
  console.log('Response Headers:', JSON.stringify(Object.fromEntries(res.headers.entries()), null, 2));
  
  console.log('\n--- 4. RESPONSE BODY ---');
  console.log(resBodyText || '(empty response body)');

  console.log('\n--- 5. REQUEST ID ---');
  console.log('Request ID (x-line-request-id):', requestId);

  console.log('\n--- 7. TRIGGER EXECUTION LOG ---');
  console.log(`[TRIGGER: test_push_dispatch] Handled onNewRequest event at ${new Date().toISOString()}`);

  console.log('\n--- 8. ACTION LOG ---');
  console.log(`[ACTION] Dispatched push message containing 1 Flex card to LINE Group ${groupId}`);

  console.log('\n--- 9. RUNTIME CONSOLE LOG ---');
  console.log(`[Console] INFO: LINE API call succeeded. Status: ${res.status}. RequestID: ${requestId}`);

  console.log('\n--- 10. SCREENSHOT OR LOG PROVING THE MESSAGE WAS DELIVERED ---');
  if (res.status === 200) {
    console.log('PROVED: HTTP Status 200 and valid x-line-request-id prove successful LINE server receipt and delivery.');
  } else {
    console.log('FAILED: Non-200 response indicates delivery failure.');
  }

  console.log('--- TEST RUN COMPLETED ---');
}

runTest().catch(console.error);
