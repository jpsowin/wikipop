const https = require('https');

function getNewsletter() {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.buttondown.com',
      port: 443,
      path: '/v1/newsletters',
      method: 'GET',
      headers: {
        'Authorization': `Token ${process.env.BUTTONDOWN_API_KEY}`
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve(JSON.parse(data));
      });
    });
    req.end();
  });
}

function updateNewsletter(id, updates) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(updates);
    const req = https.request({
      hostname: 'api.buttondown.com',
      port: 443,
      path: `/v1/newsletters/${id}`,
      method: 'PATCH',
      headers: {
        'Authorization': `Token ${process.env.BUTTONDOWN_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve(JSON.parse(data));
      });
    });
    req.write(payload);
    req.end();
  });
}

async function run() {
  try {
    const data = await getNewsletter();
    console.log("Current newsletter settings:", JSON.stringify(data.results[0], null, 2));
    
    // Attempt to update settings to fix header injection
    const updates = {};
    if (data.results[0].template !== "naked") {
      updates.template = "naked";
    }
    
    if (Object.keys(updates).length > 0) {
      console.log("Applying updates:", updates);
      const res = await updateNewsletter(data.results[0].id, updates);
      console.log("Update result:", res);
    } else {
      console.log("No updates needed.");
    }
  } catch (err) {
    console.error(err);
  }
}
run();
