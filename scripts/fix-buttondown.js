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
  // Step 1: Get newsletter info
  console.log("=== Step 1: Fetching newsletter info ===");
  const newsletters = await apiCall('GET', '/v1/newsletters');
  console.log("Status:", newsletters.status);
  
  if (newsletters.status !== 200) {
    console.log("Response:", JSON.stringify(newsletters.data));
    return;
  }

  const newsletter = newsletters.data.results ? newsletters.data.results[0] : newsletters.data;
  console.log("Newsletter ID:", newsletter.id);
  console.log("Newsletter name:", newsletter.name);
  console.log("Current template:", newsletter.template);
  console.log("Current CSS (first 200 chars):", (newsletter.css || "").substring(0, 200));
  console.log("All keys:", Object.keys(newsletter).join(", "));
  
  // Step 2: Try to update CSS to hide masthead
  console.log("\n=== Step 2: Attempting to set CSS ===");
  const cssUpdate = await apiCall('PATCH', `/v1/newsletters/${newsletter.id}`, {
    css: `.newsletter-masthead .subject { display: none !important; }`
  });
  console.log("CSS update status:", cssUpdate.status);
  console.log("CSS update response:", JSON.stringify(cssUpdate.data).substring(0, 500));

  // Step 3: If CSS worked, send a test email
  if (cssUpdate.status >= 200 && cssUpdate.status < 300) {
    console.log("\n=== Step 3: CSS update succeeded! Sending test email ===");
    const draft = await apiCall('POST', '/v1/emails', {
      subject: '[Test CSS Fix] WikiPop Preview Test',
      body: `<!-- buttondown-editor-mode: fancy -->
<div style="display:none;font-size:1px;color:#333333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;mso-hide:all;">
  THIS IS THE SECRET TEASER TEXT THAT SHOULD SHOW IN THE PREVIEW.
  &zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;
</div>
<p>This is the actual email body. The subject should NOT appear above this.</p>`,
      status: 'draft'
    });
    
    if (draft.data && draft.data.id) {
      console.log("Draft created:", draft.data.id);
      const send = await apiCall('POST', `/v1/emails/${draft.data.id}/send-draft`, {
        recipients: ['josh@sowin.io']
      });
      console.log("Test email sent! Status:", send.status);
    } else {
      console.log("Failed to create draft:", JSON.stringify(draft.data));
    }
  } else {
    console.log("CSS update failed. Trying template change instead...");
    
    // Step 3b: Try setting template to naked
    const templateUpdate = await apiCall('PATCH', `/v1/newsletters/${newsletter.id}`, {
      template: 'naked'
    });
    console.log("Template update status:", templateUpdate.status);
    console.log("Template update response:", JSON.stringify(templateUpdate.data).substring(0, 500));
  }
}

run().catch(console.error);
