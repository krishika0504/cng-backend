import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { PLAN_CONFIG } from '@/lib/subscription';
import { applyReferralCommission } from '@/lib/referral';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

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
        // Allow distinct roles if necessary, but essentially check ID
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
        const { planType, autoPay } = body;

        if (!planType) {
            return NextResponse.json(
                { error: 'Plan type is required' },
                { status: 400, headers: corsHeaders }
            );
        }

        // Validate plan type
        if (!PLAN_CONFIG[planType as keyof typeof PLAN_CONFIG]) {
            return NextResponse.json(
                { error: 'Invalid plan type' },
                { status: 400, headers: corsHeaders }
            );
        }

        const plan = PLAN_CONFIG[planType as keyof typeof PLAN_CONFIG];
        const durationDays = plan.duration;

        // Calculate expire date
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(startDate.getDate() + durationDays);

        // For free trial with auto-pay, set auto-renew to 1_month plan
        const autoRenewPlan = planType === 'free_trial' && autoPay ? '1_month' : (autoPay ? planType : null);

        // Update user subscription and apply referral commission in one transaction.
        const updatedUser = await prisma.$transaction(async (tx) => {
            const user = await tx.user.update({
                where: { id: userId },
                data: {
                    subscriptionType: planType,
                    subscriptionEndsAt: endDate,
                    // autoRenewPlan: autoRenewPlan, // Uncomment after migration is applied
                },
            });

            await applyReferralCommission(tx, userId, planType, plan.price);
            return user;
        });

        // Log activity (optional, if you track sales)
        // await prisma.paymentHistory.create({...})

        return NextResponse.json(
            {
                message: 'Subscription activated successfully',
                subscription: {
                    type: planType,
                    expiresAt: endDate,
                    autoRenewPlan: autoRenewPlan,
                }
            },
            { status: 200, headers: corsHeaders }
        );

    } catch (error) {
        console.error('Subscription error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500, headers: corsHeaders }
        );
    }
}
