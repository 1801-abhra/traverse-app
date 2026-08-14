const { BrevoClient } = require('@getbrevo/brevo');

const client = new BrevoClient({
    apiKey: process.env.BREVO_API_KEY
});

const sendVerificationEmail = async (email, name, token) => {
    const verifyUrl = `https://traverse-app.onrender.com/api/auth/verify-email/${token}`;
    try {
        await client.transactionalEmails.sendTransacEmail({
            subject: '✅ Verify your Traverse-Unicab account',
            to: [{ email, name }],
            sender: { name: 'Traverse-Unicab', email: 'traverseuni@gmail.com' },
            htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: white; padding: 40px; border-radius: 12px;">
          <h1 style="color: #e63946; text-align: center; letter-spacing: 4px;">TRAVERSE</h1>
          <h2 style="color: white;">Hi ${name}! 👋</h2>
          <p style="color: #999; line-height: 1.6;">Welcome to Traverse-Unicab! Please verify your email to activate your account.</p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${verifyUrl}" style="background: #e63946; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
              Verify Email Address
            </a>
          </div>
          <p style="color: #666; font-size: 13px;">This link expires in 24 hours.</p>
        </div>
      `
        });
        console.log('Verification email sent to:', email);
    } catch (err) {
        console.log('Email error:', err.message);
    }
};

const sendPasswordResetEmail = async (email, name, token) => {
    const resetUrl = `https://traverse-unicab.vercel.app/reset-password/${token}`;
    try {
        await client.transactionalEmails.sendTransacEmail({
            subject: '🔑 Reset your Traverse-Unicab password',
            to: [{ email, name }],
            sender: { name: 'Traverse-Unicab', email: 'traverseuni@gmail.com' },
            htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: white; padding: 40px; border-radius: 12px;">
          <h1 style="color: #e63946; text-align: center; letter-spacing: 4px;">TRAVERSE</h1>
          <h2 style="color: white;">Hi ${name}! 👋</h2>
          <p style="color: #999; line-height: 1.6;">We received a request to reset your password.</p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${resetUrl}" style="background: #e63946; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
              Reset Password
            </a>
          </div>
          <p style="color: #666; font-size: 13px;">This link expires in 1 hour.</p>
        </div>
      `
        });
        console.log('Reset email sent to:', email);
    } catch (err) {
        console.log('Email error:', err.message);
    }
};

module.exports = { sendVerificationEmail, sendPasswordResetEmail };