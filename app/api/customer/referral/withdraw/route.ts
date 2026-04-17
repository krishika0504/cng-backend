import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { corsHeaders } from '@/lib/api-utils';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

const withdrawSchema = z.object({
  amountPaise: z.number().int().positive().optional(),
  upiId: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{2,}@[a-z]{2,}$/, 'Invalid UPI ID format'),
});

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

function verifyUserToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; role: string };
    if (decoded.role !== 'customer') {
      return null;
    }
    return decoded.userId;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = verifyUserToken(request);
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await request.json().catch(() => ({}));
    const validation = withdrawSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid withdrawal amount' },
        { status: 400, headers: corsHeaders }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        referralWalletPaise: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404, headers: corsHeaders }
      );
    }

    const currentWalletPaise = user.referralWalletPaise || 0;
    if (currentWalletPaise <= 0) {
      return NextResponse.json(
        { error: 'No referral earnings available to withdraw' },
        { status: 400, headers: corsHeaders }
      );
    }

    const requestedAmountPaise = validation.data.amountPaise ?? currentWalletPaise;
    const upiId = validation.data.upiId;
    if (requestedAmountPaise > currentWalletPaise) {
      return NextResponse.json(
        { error: 'Requested amount exceeds wallet balance' },
        { status: 400, headers: corsHeaders }
      );
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        referralWalletPaise: {
          decrement: requestedAmountPaise,
        },
      },
      select: {
        referralWalletPaise: true,
      },
    });

    return NextResponse.json(
      {
        message: 'Withdrawal request processed successfully',
        upiId,
        withdrawnPaise: requestedAmountPaise,
        remainingWalletPaise: updatedUser.referralWalletPaise,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    console.error('Referral withdrawal error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}
