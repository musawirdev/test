// Simple in-memory database for API keys and credits
// In production, you'd use a real database like SQLite, MongoDB, etc.

let apiKeysDatabase = {
  // Example structure:
  // "API_KEY_123": {
  //   credits: 100,
  //   createdAt: "2024-01-01T00:00:00.000Z",
  //   usedBy: null, // chat ID when redeemed
  //   isActive: true
  // }
};

let userCredits = {
  // userChatId: credits
};

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action } = req.query;

  try {
    switch (action) {
      case 'redeem':
        return await handleRedeemKey(req, res);
      case 'check':
        return await handleCheckCredits(req, res);
      case 'deduct':
        return await handleDeductCredits(req, res);
      case 'generate':
        return await handleGenerateKey(req, res);
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('Credits API Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Redeem API key for credits
async function handleRedeemKey(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { apiKey, username, chatId } = req.body;

  if (!apiKey || !username) {
    return res.status(400).json({ error: 'API key and username required' });
  }

  // Check if API key exists and is valid
  if (!apiKeysDatabase[apiKey]) {
    return res.status(400).json({ error: 'Invalid API key' });
  }

  const keyData = apiKeysDatabase[apiKey];

  if (!keyData.isActive) {
    return res.status(400).json({ error: 'API key has been deactivated' });
  }

  if (keyData.usedBy && keyData.usedBy !== username) {
    return res.status(400).json({ error: 'API key already used by another user' });
  }

  // Use username as primary identifier, chatId as secondary
  const userId = username;
  
  // Add credits to user
  if (!userCredits[userId]) {
    userCredits[userId] = 0;
  }

  // If first time using this key
  if (!keyData.usedBy) {
    userCredits[userId] += keyData.credits;
    keyData.usedBy = username;
    keyData.chatId = chatId || null;
    keyData.redeemedAt = new Date().toISOString();
    
    // Send notification to admin about API key redemption
    await sendAdminNotification(apiKey, username, keyData.credits);
  }

  return res.status(200).json({
    success: true,
    creditsAdded: keyData.credits,
    totalCredits: userCredits[userId],
    message: `Successfully redeemed ${keyData.credits} credits!`
  });
}

// Check user credits
async function handleCheckCredits(req, res) {
  const { chatId, username } = req.query;

  // Use username if provided, otherwise fallback to chatId
  const userId = username || chatId;

  if (!userId) {
    return res.status(400).json({ error: 'Username or Chat ID required' });
  }

  const credits = userCredits[userId] || 0;

  return res.status(200).json({
    userId,
    credits,
    hasCredits: credits > 0
  });
}

// Deduct credits when CC checking
async function handleDeductCredits(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, chatId, amount = 1 } = req.body;

  // Use username if provided, otherwise fallback to chatId
  const userId = username || chatId;

  if (!userId) {
    return res.status(400).json({ error: 'Username or Chat ID required' });
  }

  const currentCredits = userCredits[userId] || 0;

  if (currentCredits < amount) {
    return res.status(400).json({ 
      error: 'Insufficient credits',
      currentCredits,
      required: amount
    });
  }

  userCredits[userId] -= amount;

  return res.status(200).json({
    success: true,
    deducted: amount,
    remainingCredits: userCredits[userId]
  });
}

// Generate new API key (for admin/bot use)
async function handleGenerateKey(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { credits, adminKey } = req.body;

  // Simple admin authentication
  const ADMIN_KEY = process.env.ADMIN_KEY || "rajachecker_admin_2024";
  
  if (adminKey !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!credits || credits <= 0) {
    return res.status(400).json({ error: 'Valid credits amount required' });
  }

  // Generate unique API key
  const apiKey = generateApiKey();
  
  // Store in database
  apiKeysDatabase[apiKey] = {
    credits: parseInt(credits),
    createdAt: new Date().toISOString(),
    usedBy: null,
    isActive: true
  };

  return res.status(200).json({
    success: true,
    apiKey,
    credits: parseInt(credits),
    message: `Generated new API key with ${credits} credits`
  });
}

// Helper function to generate unique API key
function generateApiKey() {
  const prefix = "DARKBOY";
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2);
  return `${prefix}_${timestamp}_${random}`.toUpperCase();
}

// Send notification to admin about API key redemption
async function sendAdminNotification(apiKey, username, credits) {
  try {
    const ADMIN_BOT_TOKEN = process.env.SERVER_BOT_TOKEN;
    const ADMIN_CHAT_ID = process.env.SERVER_CHAT_ID;

    if (!ADMIN_BOT_TOKEN || !ADMIN_CHAT_ID) {
      console.log('Admin notification skipped - no admin bot token/chat ID configured');
      return;
    }

    const message = `🎯 **NEW API KEY REDEEMED**\n\n` +
      `👤 **User:** ${username}\n` +
      `🔑 **API Key:** \`${apiKey}\`\n` +
      `💰 **Credits:** ${credits}\n` +
      `⏰ **Time:** ${new Date().toLocaleString()}\n\n` +
      `💡 **DarkBoy Credits System**`;

    const response = await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ADMIN_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      })
    });

    if (response.ok) {
      console.log('✅ Admin notification sent successfully');
    } else {
      console.log('❌ Admin notification failed');
    }
  } catch (error) {
    console.error('Admin notification error:', error);
  }
}

// Export helper functions for use in other API routes
export { userCredits, apiKeysDatabase };
