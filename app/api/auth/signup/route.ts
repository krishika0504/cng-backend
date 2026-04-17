import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signJwt } from '@/lib/auth';
import { corsHeaders } from '@/lib/api-utils';
import { generateUniqueReferralCode } from '@/lib/referral';

const signupSchema = z.object({
  name: z.string().min(2).max(100).trim(),
  email: z.string().email().trim().toLowerCase(),
  phone: z.string().min(10).max(15, 'Invalid phone number'),
  vehicleNo: z.string().min(4).max(20).trim().toUpperCase(),
  referralCode: z.string().trim().toUpperCase().min(4).max(20).optional(),
  password: z.string()
    .min(6, 'Password must be at least 6 characters')
    .max(100),
});

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = signupSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: validation.error.flatten() },
        { status: 400, headers: corsHeaders }
      );
    }

    const { name, email, phone, vehicleNo, referralCode, password } = validation.data;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'Email already registered' },
        { status: 409, headers: corsHeaders }
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    let referrer: { id: string } | null = null;
    if (referralCode) {
      referrer = await prisma.user.findUnique({
        where: { referralCode },
        select: { id: true },
      });

      if (!referrer) {
        return NextResponse.json(
          { error: 'Invalid referral code' },
          { status: 400, headers: corsHeaders }
        );
      }
    }

    // Create user with vehicle in a transaction
    const user = await prisma.$transaction(async (tx) => {
      const newReferralCode = await generateUniqueReferralCode(tx);

      const createdUser = await tx.user.create({
        data: {
          name,
          email,
          phone,
          passwordHash,
          role: 'customer',
          referralCode: newReferralCode,
          referredById: referrer?.id || null,
          vehicles: {
            create: {
              plate: vehicleNo,
              regionCode: vehicleNo.substring(0, 2).toUpperCase(),
            },
          },
        },
        include: {
          vehicles: true,
        },
      });

      if (referrer) {
        await tx.referral.create({
          data: {
            referrerId: referrer.id,
            refereeId: createdUser.id,
            status: 'pending',
          },
        });
      }

      return createdUser;
    });

    // Generate JWT token
    const token = signJwt({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    return NextResponse.json(
      {
        message: 'Account created successfully',
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          phone: user.phone,
          role: user.role,
          vehicles: user.vehicles,
          referralCode: user.referralCode,
          referralWalletPaise: user.referralWalletPaise,
          referralLifetimeEarnedPaise: user.referralLifetimeEarnedPaise,
          referralCount: user.referralCount,
        },
      },
      { status: 201, headers: corsHeaders }
    );
  } catch (error) {
    console.error('Signup error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}
