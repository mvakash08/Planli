// Vercel Serverless Function: Verify Mobile OTP via Fast2SMS
const FAST2SMS_API_KEY = process.env.FAST2SMS_API_KEY || "99Sf6HoQlZhY9a6l2gEAd4EF1hER3pTS3AqepBRVOq6MLL9jMIwOLDU3yG9VpkJ0hPcaGil0Sot6M1Eh";

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
    const { phone, otp } = req.body || {};
    const cleanPhone = (phone || "").replace(/[^0-9]/g, "").slice(-10);
    const cleanOtp = (otp || "").trim();

    if (!cleanPhone || cleanPhone.length !== 10) {
      return res.status(400).json({ success: false, error: "Please provide a valid 10-digit mobile number." });
    }

    if (!cleanOtp || cleanOtp.length < 4) {
      return res.status(400).json({ success: false, error: "Please provide the valid OTP code." });
    }

    // Call Fast2SMS verify OTP endpoint
    const response = await fetch("https://www.fast2sms.com/dev/otp/verify", {
      method: "POST",
      headers: {
        authorization: FAST2SMS_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        mobile: cleanPhone,
        otp: cleanOtp
      })
    });

    const data = await response.json();

    if (data.return === false || data.status_code >= 400) {
      return res.status(400).json({
        success: false,
        error: data.message || "Invalid or expired OTP code.",
        details: data
      });
    }

    return res.status(200).json({
      success: true,
      verified: true,
      message: "Mobile number verified successfully.",
      phone: cleanPhone
    });
  } catch (err) {
    console.error("Fast2SMS verify error:", err);
    return res.status(500).json({ success: false, error: "Internal server error while verifying OTP." });
  }
}
