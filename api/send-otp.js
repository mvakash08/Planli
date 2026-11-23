// Vercel Serverless Function: Send Mobile OTP via Fast2SMS
const FAST2SMS_API_KEY = process.env.FAST2SMS_API_KEY || "99Sf6HoQlZhY9a6l2gEAd4EF1hER3pTS3AqepBRVOq6MLL9jMIwOLDU3yG9VpkJ0hPcaGil0Sot6M1Eh";
const FAST2SMS_OTP_ID = process.env.FAST2SMS_OTP_ID || "";

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed. Use POST." });
  }

  try {
    const { phone, otp_id } = req.body || {};
    const cleanPhone = (phone || "").replace(/[^0-9]/g, "").slice(-10);

    if (!cleanPhone || cleanPhone.length !== 10) {
      return res.status(400).json({ success: false, error: "Please provide a valid 10-digit mobile number." });
    }

    const templateId = otp_id || FAST2SMS_OTP_ID;

    // Call Fast2SMS Smart OTP endpoint
    const response = await fetch("https://www.fast2sms.com/dev/otp/send", {
      method: "POST",
      headers: {
        authorization: FAST2SMS_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        mobile: cleanPhone,
        otp_id: templateId || undefined,
        otp_length: 6,
        otp_expiry: 10
      })
    });

    const data = await response.json();

    if (data.return === false || data.status_code >= 400) {
      return res.status(400).json({
        success: false,
        error: data.message || "Fast2SMS failed to send OTP",
        details: data
      });
    }

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully to your mobile number.",
      requestId: data.request_id || data.data?.request_id || null
    });
  } catch (err) {
    console.error("Fast2SMS send error:", err);
    return res.status(500).json({ success: false, error: "Internal server error while sending OTP." });
  }
}
