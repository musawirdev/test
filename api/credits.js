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

  const { apiKey, chatId } = req.body;

  if (!apiKey || !chatId) {
    return res.status(400).json({ error: 'API key and chat ID required' });
  }

  // Check if API key exists and is valid
  if (!apiKeysDatabase[apiKey]) {
    return res.status(400).json({ error: 'Invalid API key' });
  }

  const keyData = apiKeysDatabase[apiKey];

  if (!keyData.isActive) {
    return res.status(400).json({ error: 'API key has been deactivated' });
  }

  if (keyData.usedBy && keyData.usedBy !== chatId) {
    return res.status(400).json({ error: 'API key already used by another user' });
  }

  // Add credits to user
  if (!userCredits[chatId]) {
    userCredits[chatId] = 0;
  }

  // If first time using this key
  if (!keyData.usedBy) {
    userCredits[chatId] += keyData.credits;
    keyData.usedBy = chatId;
    keyData.redeemedAt = new Date().toISOString();
  }

  return res.status(200).json({
    success: true,
    creditsAdded: keyData.credits,
    totalCredits: userCredits[chatId],
    message: `Successfully redeemed ${keyData.credits} credits!`
  });
}

// Check user credits
async function handleCheckCredits(req, res) {
  const { chatId } = req.query;

  if (!chatId) {
    return res.status(400).json({ error: 'Chat ID required' });
  }

  const credits = userCredits[chatId] || 0;

  return res.status(200).json({
    chatId,
    credits,
    hasCredits: credits > 0
  });
}

// Deduct credits when CC checking
async function handleDeductCredits(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { chatId, amount = 1 } = req.body;

  if (!chatId) {
    return res.status(400).json({ error: 'Chat ID required' });
  }

  const currentCredits = userCredits[chatId] || 0;

  if (currentCredits < amount) {
    return res.status(400).json({ 
      error: 'Insufficient credits',
      currentCredits,
      required: amount
    });
  }

  userCredits[chatId] -= amount;

  return res.status(200).json({
    success: true,
    deducted: amount,
    remainingCredits: userCredits[chatId]
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

// Export helper functions for use in other API routes
export { userCredits, apiKeysDatabase };
