const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const sendVerificationEmail = async (email, name, token) => {
    const verifyUrl = `https://traverse-app.onrender.com/api/auth/verify-email/${token}`;

    try {
        const info = await transporter.sendMail({
            from: `"Traverse-Unicab" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: '✅ Verify your Traverse-Unicab account',
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: white; padding: 40px; border-radius: 12px;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #e63946; letter-spacing: 4px;">TRAVERSE</h1>
            <p style="color: #999;">University Cab System</p>
          </div>
          <h2 style="color: white;">Hi ${name}! 👋</h2>
          <p style="color: #999; line-height: 1.6;">
            Welcome to Traverse-Unicab! Please verify your email address to activate your account.
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${verifyUrl}" 
               style="background: #e63946; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
              Verify Email Address
            </a>
          </div>
          <p style="color: #666; font-size: 13px;">
            This link expires in 24 hours. If you didn't create this account, ignore this email.
          </p>
          <hr style="border-color: #222; margin: 24px 0;">
          <p style="color: #666; font-size: 12px; text-align: center;">
            Traverse-Unicab • JUIT Campus • traverseuni@gmail.com
          </p>
        </div>
      `
        });
        console.log('Email sent successfully:', info.messageId);
    } catch (error) {
        console.log('Email send error:', error.message);
    }
};

module.exports = { sendVerificationEmail };