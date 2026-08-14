const Brevo = require('@getbrevo/brevo');

const defaultClient = Brevo.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;

const apiInstance = new Brevo.TransactionalEmailsApi();

const sendVerificationEmail = async (email, name, token) => {
    const verifyUrl = `https://traverse-app.onrender.com/api/auth/verify-email/${token}`;

    try {
        const sendSmtpEmail = new Brevo.SendSmtpEmail();
        sendSmtpEmail.subject = '✅ Verify your Traverse-Unicab account';
        sendSmtpEmail.to = [{ email, name }];
        sendSmtpEmail.sender = { name: 'Traverse-Unicab', email: 'traverseuni@gmail.com' };
        sendSmtpEmail.htmlContent = `
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
    `;
        const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
        console.log('Verification email sent:', result.body?.messageId);
    } catch (err) {
        console.log('Email error:', err.message);
    }
};

const sendPasswordResetEmail = async (email, name, token) => {
    const resetUrl = `https://traverse-unicab.vercel.app/reset-password/${token}`;

    try {
        const sendSmtpEmail = new Brevo.SendSmtpEmail();
        sendSmtpEmail.subject = '🔑 Reset your Traverse-Unicab password';
        sendSmtpEmail.to = [{ email, name }];
        sendSmtpEmail.sender = { name: 'Traverse-Unicab', email: 'traverseuni@gmail.com' };
        sendSmtpEmail.htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: white; padding: 40px; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="color: #e63946; letter-spacing: 4px;">TRAVERSE</h1>
          <p style="color: #999;">University Cab System</p>
        </div>
        <h2 style="color: white;">Hi ${name}! 👋</h2>
        <p style="color: #999; line-height: 1.6;">
          We received a request to reset your password. Click the button below to create a new password.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${resetUrl}" 
             style="background: #e63946; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
            Reset Password
          </a>
        </div>
        <p style="color: #666; font-size: 13px;">
          This link expires in 1 hour. If you didn't request this, ignore this email.
        </p>
        <hr style="border-color: #222; margin: 24px 0;">
        <p style="color: #666; font-size: 12px; text-align: center;">
          Traverse-Unicab • JUIT Campus • traverseuni@gmail.com
        </p>
      </div>
    `;
        const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
        console.log('Reset email sent:', result.body?.messageId);
    } catch (err) {
        console.log('Email error:', err.message);
    }
};

module.exports = { sendVerificationEmail, sendPasswordResetEmail };