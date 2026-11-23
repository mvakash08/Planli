// Standalone Node.js OTP Server using Fast2SMS (Zero external dependencies)
import http from 'http';

const PORT = process.env.PORT || 3001;
const FAST2SMS_API_KEY = process.env.FAST2SMS_API_KEY || "99Sf6HoQlZhY9a6l2gEAd4EF1hER3pTS3AqepBRVOq6MLL9jMIwOLDU3yG9VpkJ0hPcaGil0Sot6M1Eh";
const FAST2SMS_OTP_ID = process.env.FAST2SMS_OTP_ID || "";

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // Health check
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
    return sendJson(res, 200, { status: 'ok', service: 'Fast2SMS OTP Service', wallet: 'Active' });
  }

  // Parse JSON body helper
  async function parseBody() {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          resolve(JSON.parse(body || '{}'));
        } catch {
          resolve({});
        }
      });
    });
  }

  // 1. Send OTP: POST /api/send-otp
  if (req.method === 'POST' && url.pathname === '/api/send-otp') {
    const { phone, otp_id } = await parseBody();
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '').slice(-10);

    if (!cleanPhone || cleanPhone.length !== 10) {
      return sendJson(res, 400, { success: false, error: 'Please provide a valid 10-digit mobile number.' });
    }

    try {
      const templateId = otp_id || FAST2SMS_OTP_ID;
      const fRes = await fetch('https://www.fast2sms.com/dev/otp/send', {
        method: 'POST',
        headers: {
          authorization: FAST2SMS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          mobile: cleanPhone,
          otp_id: templateId || undefined,
          otp_length: 6,
          otp_expiry: 10
        })
      });

      const data = await fRes.json();
      if (data.return === false || data.status_code >= 400) {
        return sendJson(res, 400, { success: false, error: data.message || 'Fast2SMS rejected request', details: data });
      }

      return sendJson(res, 200, { success: true, message: 'OTP sent successfully to your mobile number.' });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: 'Internal server error while dispatching SMS.' });
    }
  }

  // 2. Verify OTP: POST /api/verify-otp
  if (req.method === 'POST' && url.pathname === '/api/verify-otp') {
    const { phone, otp } = await parseBody();
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '').slice(-10);
    const cleanOtp = (otp || '').trim();

    if (!cleanPhone || cleanPhone.length !== 10) {
      return sendJson(res, 400, { success: false, error: 'Please provide a valid 10-digit mobile number.' });
    }
    if (!cleanOtp || cleanOtp.length < 4) {
      return sendJson(res, 400, { success: false, error: 'Please enter the valid OTP code.' });
    }

    try {
      const fRes = await fetch('https://www.fast2sms.com/dev/otp/verify', {
        method: 'POST',
        headers: {
          authorization: FAST2SMS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          mobile: cleanPhone,
          otp: cleanOtp
        })
      });

      const data = await fRes.json();
      if (data.return === false || data.status_code >= 400) {
        return sendJson(res, 400, { success: false, error: data.message || 'Invalid or expired OTP code.' });
      }

      return sendJson(res, 200, { success: true, verified: true, phone: cleanPhone });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: 'Internal server error while verifying OTP.' });
    }
  }

  return sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Fast2SMS OTP Server running on port ${PORT}`);
});
