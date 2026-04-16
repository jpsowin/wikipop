const https = require('https');

function sendEmailTest(template) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      subject: `[Test ${template}] WikiPop Preview Test`,
      body: `
        <div style="display:none;font-size:1px;color:#333333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
          THIS IS THE SECRET TEASER TEXT THAT SHOULD SHOW IN THE PREVIEW.
          &zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;
        </div>
        <p>This is the actual email body.</p>
        <a href="{{ unsubscribe_url }}">Unsubscribe</a>
      `,
      template: template,
      status: "draft"
    });

    const req = https.request({
      hostname: 'api.buttondown.com',
      port: 443,
      path: '/v1/emails',
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.BUTTONDOWN_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const json = JSON.parse(data);
        if (json.id) {
          // send draft
          const req2 = https.request({
            hostname: 'api.buttondown.com',
            port: 443,
            path: `/v1/emails/${json.id}/send-draft`,
            method: 'POST',
            headers: {
              'Authorization': `Token ${process.env.BUTTONDOWN_API_KEY}`,
              'Content-Type': 'application/json',
              'Content-Length': JSON.stringify({ recipients: ['josh@sowin.io'] }).length
            }
          }, res2 => {
            console.log(`Sent ${template} draft test to josh@sowin.io. Status: ${res2.statusCode}`);
            resolve();
          });
          req2.write(JSON.stringify({ recipients: ['josh@sowin.io'] }));
          req2.end();
        } else {
          console.log(`Failed to create draft for ${template}:`, data);
          resolve();
        }
      });
    });
    req.write(payload);
    req.end();
  });
}

async function run() {
  await sendEmailTest("naked");
  await sendEmailTest("classic");
  await sendEmailTest("plaintext");
}
run();
