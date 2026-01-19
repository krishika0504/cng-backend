import { NextResponse } from 'next/server';

/**
 * Allowed origins for CORS
 * In production, replace with actual allowed origins
 */
const RAW_ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS;
const ALLOWED_ORIGINS = RAW_ALLOWED_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) || [
  // Vite dev server (admin-web)
 // Next.js
  'exp://10.202.200.65:8081', // Expo mobile app
  'https://cngbharat.com', // Production Frontend
  'https://www.cngbharat.com', // Production Frontend WWW
  'https://cngmain.netlify.app', // Production Deploy
];

const ALLOW_ALL_ORIGINS = ALLOWED_ORIGINS.includes('*');

/**
 * Get CORS headers based on request origin
 * Returns specific origin if allowed, otherwise rejects
 */
export function getCorsHeaders(origin?: string | null): Record<string, string> {
  // Mobile apps / Expo may send no Origin, and LAN IPs can change frequently.
  // If ALLOWED_ORIGINS includes '*', allow any origin.
  // In non-production, also allow any origin to avoid dev friction.
  const isProd = process.env.NODE_ENV === 'production';

  let allowedOrigin: string = '*';
  if (origin) {
    if (ALLOW_ALL_ORIGINS) {
      allowedOrigin = origin;
    } else if (!isProd) {
      allowedOrigin = origin;
    } else if (ALLOWED_ORIGINS.includes(origin)) {
      allowedOrigin = origin;
    } else {
      allowedOrigin = ALLOWED_ORIGINS[0] || '*';
    }
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    // Keep false by default since most endpoints use Bearer tokens (and '*' is not valid with credentials).
  };
}

/**
 * Default CORS headers for development
 * Note: Allows all origins for development
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * Standardized API response format
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  details?: unknown;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Create a success response
 */
export function successResponse<T>(
  data: T,
  pagination?: ApiResponse['pagination'],
  headers: Record<string, string> = corsHeaders
): NextResponse {
  const response: ApiResponse<T> = {
    success: true,
    data,
  };

  if (pagination) {
    response.pagination = pagination;
  }

  return NextResponse.json(response, { headers });
}

/**
 * Create an error response
 */
export function errorResponse(
  message: string,
  status: number = 500,
  details?: unknown,
  headers: Record<string, string> = corsHeaders
): NextResponse {
  const response: ApiResponse = {
    success: false,
    error: message,
  };

  if (details) {
    response.details = details;
  }

  return NextResponse.json(response, { status, headers });
}

/**
 * Handle authentication errors from auth middleware
 */
export function handleAuthError(error: unknown): NextResponse {
  if (error instanceof Error) {
    const message = error.message;

    if (message.includes('token')) {
      return errorResponse(message, 401);
    }

    if (message.includes('Admin access') || message.includes('access required')) {
      return errorResponse(message, 403);
    }
  }

  return errorResponse('Authentication failed', 401);
}

/**
 * Calculate Haversine distance between two coordinates
 * @returns Distance in kilometers
 */
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Parse pagination parameters from request
 */
export function parsePagination(searchParams: URLSearchParams, defaults = { page: 1, limit: 20 }) {
  const page = Math.max(1, parseInt(searchParams.get('page') || String(defaults.page)));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || String(defaults.limit))));
  const skip = (page - 1) * limit;

  return { page, limit, skip };
}

/**
 * Create pagination response object
 */
export function createPagination(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Validate environment variables on startup
 */
export function validateEnv(requiredVars: string[]): void {
  const missing = requiredVars.filter(v => !process.env[v]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
