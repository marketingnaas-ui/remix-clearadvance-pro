const url = 'http://localhost:3000/api/line/send-notification';

async function run() {
  console.log('--- CALLING /api/line/send-notification ENDPOINT ---');
  
  const payload = {
    triggerId: 'onNewRequest',
    variables: {
      advId: 'ADV-TEST-999',
      employeeId: 'emp-admin',
      employeeName: 'Kanyawee Puangbud',
      amount: 1500,
      projectName: 'Test Project',
      category: 'เดินทาง',
      remark: 'ขอเบิกเงินไปปฏิบัติงานนอกสถานที่',
      date: '01/07/2026'
    },
    targetEmployeeId: 'emp-admin'
  };

  console.log('HTTP Request to server:');
  console.log('URL:', url);
  console.log('Body:', JSON.stringify(payload, null, 2));

  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const status = res.status;
    const bodyText = await res.text();
    console.log('\nHTTP Response from server:');
    console.log('Status Code:', status);
    console.log('Duration:', Date.now() - start, 'ms');
    console.log('Body:', bodyText);
  } catch (err) {
    console.error('Error connecting to local server:', err.message);
  }
}

run().catch(console.error);
