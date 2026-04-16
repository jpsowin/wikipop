const https = require('https');

function apiCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.buttondown.com',
      port: 443,
      path,
      method,
      headers: {
        'Authorization': `Token ${process.env.BUTTONDOWN_API_KEY}`,
        'Content-Type': 'application/json',
      }
    };
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function run() {
  // Send ONE clean naked template test
  console.log("Sending naked template test...");
  const draft = await apiCall('POST', '/v1/emails', {
    subject: 'Bananas and Pineapples Weekly Update',
    body: `<!-- buttondown-editor-mode: naked -->
<div style="display:none;font-size:1px;color:#333333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;mso-hide:all;">
  The inverse care law is the principle that the availability of good medical care tends to vary inversely with the need for it.
</div>
<div style="max-width:560px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#1a1a1a;">
  <h1 style="font-size:22px;">Hello from WikiPop</h1>
  <p>If the naked template works, you should NOT see the subject line repeated as a big header above this content. And the Gmail preview should show the inverse care law teaser.</p>
  <p><a href="{{ unsubscribe_url }}">Unsubscribe</a></p>
</div>`,
    status: 'draft',
    template: 'naked'
  });
  console.log('Draft status:', draft.status);
  console.log('Draft ID:', draft.data?.id);
  console.log('Draft template:', draft.data?.template);
  console.log('Full response keys:', draft.data ? Object.keys(draft.data).join(', ') : 'N/A');
  
  if (draft.data && draft.data.id) {
    const send = await apiCall('POST', `/v1/emails/${draft.data.id}/send-draft`, {
      recipients: ['josh@sowin.io']
    });
    console.log('Send status:', send.status);
    console.log('Sent!');
  } else {
    console.log('Draft creation failed:', JSON.stringify(draft.data));
  }
}
run().catch(console.error);
