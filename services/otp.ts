import { secureAuthRequest } from './secureAuth';
import { supabase } from './supabase';
import { api } from './api';

export interface OTPRecord {
  id: string;
  email: string;
  code: string;
  expires_at: string;
  used: boolean;
  created_at: string;
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const normalizePatientUsernameForAuth = (value?: string | null): string | null => {
  const normalized = value?.trim().replace(/\s+/g, ' ').toLowerCase();
  return normalized || null;
};

export const otpService = {
  generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  },

  async getCurrentUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      console.warn('Unable to read current Supabase user:', error.message);
      return null;
    }
    return data.user;
  },

  async updatePassword(password: string): Promise<{ success: boolean; message?: string }> {
    const trimmedPassword = password.trim();
    if (trimmedPassword.length < 6) {
      return { success: false, message: 'Password must be at least 6 characters long.' };
    }

    const { error } = await supabase.auth.updateUser({ password: trimmedPassword });
    if (error) {
      return { success: false, message: error.message };
    }

    return { success: true };
  },

  generateResetToken(): string {
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
      return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  },

  getPendingSignupKey(email: string): string {
    return `pending_patient_signup_${email.toLowerCase().trim()}`;
  },

  isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.toLowerCase().trim());
  },

  escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  async getClinicName(): Promise<string> {
    try {
      return await api.appSettings.getAppName();
    } catch (error) {
      return 'DentalCloud Pro';
    }
  },

  async invalidateCodes(email: string): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();
    try {
      const { error } = await supabase
        .from('otp_codes')
        .update({ used: true })
        .eq('email', normalizedEmail)
        .eq('used', false);

      if (error) {
        console.warn('Unable to invalidate previous auth email codes:', error.message);
      }
    } catch (error) {
      console.warn('Unable to invalidate previous auth email codes:', error);
    }
  },

  async storeAuthCode(email: string, code: string, ttlMinutes: number): Promise<OTPRecord> {
    const normalizedEmail = email.toLowerCase().trim();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    await this.invalidateCodes(normalizedEmail);

    const { data, error } = await supabase
      .from('otp_codes')
      .insert({
        email: normalizedEmail,
        code,
        expires_at: expiresAt.toISOString(),
        used: false
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to store verification code: ${error.message}`);
    }

    return data;
  },

  async verifyAuthCode(email: string, code: string, markUsed = true): Promise<boolean> {
    const normalizedEmail = email.toLowerCase().trim();
    const normalizedCode = code.trim();

    if (!this.isValidEmail(normalizedEmail) || !/^[A-Za-z0-9_-]{6,64}$/.test(normalizedCode)) {
      return false;
    }

    const { data, error } = await supabase
      .from('otp_codes')
      .select('*')
      .eq('email', normalizedEmail)
      .eq('code', normalizedCode)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) {
      if (error) console.error('Verification code lookup error:', error);
      return false;
    }

    if (markUsed) {
      const { error: updateError } = await supabase
        .from('otp_codes')
        .update({ used: true })
        .eq('id', data[0].id);

      if (updateError) {
        throw new Error(updateError.message);
      }
    }

    return true;
  },

  buildEmailHtml(params: {
    title: string;
    eyebrow: string;
    message: string;
    code: string;
    expiryText: string;
    clinicName: string;
  }): string {
    const safeTitle = this.escapeHtml(params.title);
    const safeEyebrow = this.escapeHtml(params.eyebrow);
    const safeMessage = this.escapeHtml(params.message);
    const safeCode = this.escapeHtml(params.code);
    const safeExpiryText = this.escapeHtml(params.expiryText);
    const safeClinicName = this.escapeHtml(params.clinicName);

    return `
      <div style="margin:0;padding:0;background:#020617;font-family:Inter,Arial,sans-serif;color:#e5e7eb;">
        <div style="max-width:620px;margin:0 auto;padding:32px 18px;">
          <div style="background:#0f172a;border:1px solid #1e293b;border-radius:22px;overflow:hidden;box-shadow:0 24px 80px rgba(15,23,42,.45);">
            <div style="height:7px;background:linear-gradient(90deg,#2563eb,#06b6d4,#8b5cf6);"></div>
            <div style="padding:30px;">
              <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#38bdf8;font-weight:800;margin-bottom:12px;">${safeEyebrow}</div>
              <h1 style="margin:0 0 14px;font-size:28px;line-height:1.15;color:#ffffff;font-weight:900;">${safeTitle}</h1>
              <p style="margin:0 0 24px;color:#cbd5e1;font-size:15px;line-height:1.65;">${safeMessage}</p>
              <div style="background:#111827;border:1px solid #334155;border-radius:16px;padding:22px;margin:22px 0;text-align:center;">
                <div style="font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.12em;font-weight:800;margin-bottom:10px;">Your OTP code</div>
                <div style="font-size:34px;letter-spacing:.32em;color:#ffffff;font-weight:900;">${safeCode}</div>
              </div>
              <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.55;">${safeExpiryText}</p>
            </div>
            <div style="padding:18px 30px;background:#020617;border-top:1px solid #1e293b;color:#64748b;font-size:12px;">${safeClinicName} - Secure patient portal</div>
          </div>
        </div>
      </div>
    `;
  },

  async sendPatientAuthEmail(params: {
    to: string;
    subject: string;
    html: string;
    text: string;
    clinicName: string;
  }): Promise<void> {
    await api.email.sendManagerEmail({
      to: params.to,
      subject: params.subject,
      body: params.text,
      html: params.html,
      fromName: params.clinicName
    });
  },

  async cleanupPendingSignupConflicts(email: string, username?: string): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();
    const normalizedUsername = normalizePatientUsernameForAuth(username);

    if (!normalizedUsername) return;

    try {
      const { data: pendingAuthRows, error } = await supabase
        .from('patient_auth')
        .select('id, patient_id, email, username, is_verified')
        .eq('username', normalizedUsername)
        .eq('is_verified', false);

      if (error || !pendingAuthRows?.length) {
        if (error) console.warn('Pending signup cleanup lookup failed:', error.message);
        return;
      }

      const staleRows = pendingAuthRows.filter((row: any) => row.email !== normalizedEmail);
      if (staleRows.length === 0) return;

      const staleAuthIds = staleRows.map((row: any) => row.id).filter(Boolean);
      const stalePatientIds = staleRows.map((row: any) => row.patient_id).filter(Boolean);
      const staleEmails = staleRows.map((row: any) => row.email).filter(Boolean);

      if (staleAuthIds.length) {
        const { error: authDeleteError } = await supabase
          .from('patient_auth')
          .delete()
          .in('id', staleAuthIds);
        if (authDeleteError) {
          console.warn('Pending signup auth cleanup failed:', authDeleteError.message);
          return;
        }
      }

      if (stalePatientIds.length) {
        const { error: patientDeleteError } = await supabase
          .from('patients')
          .delete()
          .in('id', stalePatientIds);
        if (patientDeleteError) {
          console.warn('Pending signup patient cleanup failed:', patientDeleteError.message);
        }
      }

      if (staleEmails.length) {
        await supabase
          .from('otp_codes')
          .update({ used: true })
          .in('email', staleEmails)
          .eq('used', false);
      }
    } catch (error) {
      console.warn('Pending signup cleanup failed:', error);
    }
  },

  async sendSignupOtpEmail(
    email: string,
    profile: { username?: string; phone?: string; age?: number; address?: string; city?: string; township?: string },
    password: string
  ): Promise<{ success: boolean; message: string }> {
    try { return await secureAuthRequest('signup', { email, profile, password }); }
    catch (error) { return { success:false, message:error instanceof Error ? error.message : 'Signup unavailable.' }; }
  },

  async verifySignupOtp(email: string, code: string): Promise<{ success: boolean; message: string; email?: string }> {
    try { return await secureAuthRequest('verify-signup', { email, code }); }
    catch (error) { return { success:false, message:error instanceof Error ? error.message : 'Verification unavailable.' }; }
  },

  async resendSignupOtp(email: string): Promise<{ success: boolean; message: string }> {
    try { return await secureAuthRequest('resend', { email }); }
    catch (error) { return { success:false, message:error instanceof Error ? error.message : 'Resend unavailable.' }; }
  },

  async isEmailRegistered(email: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('patient_auth')
        .select('id, is_verified')
        .eq('email', email.toLowerCase().trim())
        .limit(1);

      if (error) {
        console.error('Email check error:', error);
        return false;
      }

      return Boolean(data && data.some((record: any) => record.is_verified !== false));
    } catch (error) {
      console.error('Email registration check failed:', error);
      return false;
    }
  },

  async isUsernameRegistered(username: string): Promise<boolean> {
    try {
      const normalized = normalizePatientUsernameForAuth(username);
      if (!normalized) return false;

      const { data, error } = await supabase
        .from('patient_auth')
        .select('id, is_verified')
        .eq('username', normalized)
        .limit(1);

      if (error) {
        console.error('Username check error:', error);
        return false;
      }

      return Boolean(data && data.some((record: any) => record.is_verified !== false));
    } catch (error) {
      console.error('Username registration check failed:', error);
      return false;
    }
  },

  async requestPasswordReset(email: string): Promise<{ success: boolean; message: string }> {
    try { return await secureAuthRequest('reset-request', { email }); }
    catch (error) { return { success:false, message:error instanceof Error ? error.message : 'Recovery unavailable.' }; }
  },

  async completePasswordReset(newPassword: string, email?: string, code?: string): Promise<{ success: boolean; message: string; email?: string }> {
    try { return await secureAuthRequest('reset-complete', { email, code, password: newPassword }); }
    catch (error) { return { success:false, message:error instanceof Error ? error.message : 'Reset unavailable.' }; }
  },

  // Legacy 6-digit OTP helpers retained for compatibility with any older screens.
  async storeOTP(email: string, code: string): Promise<OTPRecord> {
    const expires_at = new Date(Date.now() + 5 * 60 * 1000);

    const { data, error } = await supabase
      .from('otp_codes')
      .insert({
        email: email.toLowerCase().trim(),
        code,
        expires_at: expires_at.toISOString()
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to store OTP: ${error.message}`);
    }

    return data;
  },

  async verifyOTPLegacy(email: string, code: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('otp_codes')
        .select('*')
        .eq('email', email.toLowerCase().trim())
        .eq('code', code)
        .eq('used', false)
        .gt('expires_at', new Date().toISOString())
        .limit(1);

      if (error || !data || data.length === 0) {
        return false;
      }

      await supabase
        .from('otp_codes')
        .update({ used: true })
        .eq('id', data[0].id);

      return true;
    } catch (error) {
      console.error('OTP verification failed:', error);
      return false;
    }
  }
};
