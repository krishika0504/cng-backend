import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { applyReferralCommission } from '@/lib/referral';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'your_razorpay_secret_key';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Subscription plan pricing configuration (must match customer/subscription route)
const PLAN_CONFIG = {
    free_trial: { price: 0, duration: 15, name: 'Free Trial' },
    '1_month': { price: 15, duration: 30, name: '1 Month' },
    '6_month': { price: 79, duration: 180, name: '6 Months' },
    '1_year': { price: 150, duration: 365, name: '1 Year' },
} as const;

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
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
        if (!decoded.userId) return null;
        return decoded.userId;
    } catch (error) {
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

        const body = await request.json();
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, planType } = body;

        const generated_signature = crypto
            .createHmac('sha256', RAZORPAY_KEY_SECRET)
            .update(razorpay_order_id + '|' + razorpay_payment_id)
            .digest('hex');

        if (generated_signature !== razorpay_signature) {
            return NextResponse.json(
                { error: 'Invalid payment signature' },
                { status: 400, headers: corsHeaders }
            );
        }

        // Payment verified, update subscription
        // Validate plan type
        if (!PLAN_CONFIG[planType as keyof typeof PLAN_CONFIG]) {
            return NextResponse.json(
                { error: 'Invalid plan type' },
                { status: 400, headers: corsHeaders }
            );
        }

        const plan = PLAN_CONFIG[planType as keyof typeof PLAN_CONFIG];
        const durationDays = plan.duration;

        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(startDate.getDate() + durationDays);

        const referralReward = await prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { id: userId },
                data: {
                    subscriptionType: planType,
                    subscriptionEndsAt: endDate,
                },
            });

            return applyReferralCommission(tx, userId, planType, plan.price);
        });

        // Optional: Save transaction record
        // await prisma.payment.create({...})

        return NextResponse.json(
            {
                message: 'Payment verified and subscription activated',
                referralReward: referralReward
                    ? {
                        credited: true,
                        commissionPaise: referralReward.commissionPaise,
                        referrerId: referralReward.referrerId,
                    }
                    : { credited: false },
            },
            { status: 200, headers: corsHeaders }
        );

    } catch (error) {
        console.error('Verify payment error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500, headers: corsHeaders }
        );
    }
}
