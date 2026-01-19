/**
 * Environment Configuration and Validation
 * This file validates required environment variables at startup
 */

interface EnvConfig {
  // Required
  JWT_SECRET: string;
  DATABASE_URL: string;

  // Optional with defaults
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  ALLOWED_ORIGINS: string[];

  // External services (optional)
  GOOGLE_MAPS_API_KEY?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
}

const requiredEnvVars = [
  'JWT_SECRET',
  'DATABASE_URL',
] as const;

const optionalEnvVars = {
  NODE_ENV: 'development',
  PORT: 3000,
  ALLOWED_ORIGINS: 'https://cngbharat.com,https://www.cngbharat.com',
  GOOGLE_MAPS_API_KEY: '',
  RAZORPAY_WEBHOOK_SECRET: '',
} as const;

/**
 * Validate and parse environment variables
 */
function validateEnv(): EnvConfig {
  const missing: string[] = [];

  // Check required variables
  for (const key of requiredEnvVars) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing.map(v => `  - ${v}`).join('\n')}\n\n` +
      `Please create a .env file with these variables or set them in your environment.`
    );
  }

  // Validate JWT_SECRET strength
  const jwtSecret = process.env.JWT_SECRET!;
  if (jwtSecret.length < 32) {
    console.warn('⚠️  JWT_SECRET should be at least 32 characters for security');
  }
  if (process.env.NODE_ENV === 'production') {
    const weakSecrets = ['secret', 'password', 'changeme', 'your-secret', 'jwt-secret'];
    if (weakSecrets.some(weak => jwtSecret.toLowerCase().includes(weak))) {
      throw new Error('JWT_SECRET appears to be a weak/default value. Please use a strong random secret in production.');
    }
  }

  return {
    JWT_SECRET: jwtSecret,
    DATABASE_URL: process.env.DATABASE_URL!,
    NODE_ENV: (process.env.NODE_ENV as EnvConfig['NODE_ENV']) || 'development',
    PORT: parseInt(process.env.PORT || String(optionalEnvVars.PORT)),
    ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || optionalEnvVars.ALLOWED_ORIGINS).split(','),
    GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
    RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
  };
}

// Validate on import (fails fast at startup)
export const env = validateEnv();

// Export individual values for convenience
export const {
  JWT_SECRET,
  DATABASE_URL,
  NODE_ENV,
  PORT,
  ALLOWED_ORIGINS,
  GOOGLE_MAPS_API_KEY,
  RAZORPAY_WEBHOOK_SECRET,
} = env;

export const isProduction = NODE_ENV === 'production';
export const isDevelopment = NODE_ENV === 'development';
export const isTest = NODE_ENV === 'test';
