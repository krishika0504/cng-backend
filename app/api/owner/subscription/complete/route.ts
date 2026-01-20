import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyJwt } from '@/lib/auth';
import { corsHeaders } from '@/lib/api-utils';
import { activateSubscription, getPlanDetails } from '@/lib/subscription-activation';
import crypto from 'crypto';

const verifySchema = z.object({
  razorpay_order_id: z.string(),
  razorpay_payment_id: z.string(),
  razorpay_signature: z.string(),
  planId: z.enum(['basic', 'standard', 'premium', 'trial']),
});

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: corsHeaders }
      );
    }

    const token = authHeader.split(' ')[1];
    const payload = verifyJwt(token);

    if (!payload || payload.role !== 'owner') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await request.json();
    const validation = verifySchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid payment data' },
        { status: 400, headers: corsHeaders }
      );
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, planId } = validation.data;

    // Verify Razorpay signature
    const secret = process.env.RAZORPAY_KEY_SECRET!;
    const signaturePayload = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto.createHmac('sha256', secret).update(signaturePayload).digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return NextResponse.json(
        { error: 'Invalid payment signature' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Activate subscription using shared function
    const result = await activateSubscription(
      payload.userId,
      planId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to activate subscription' },
        { status: 500, headers: corsHeaders }
      );
    }

    const plan = getPlanDetails(planId);

    return NextResponse.json({
      success: true,
      message: 'Payment verified and subscription activated',
      subscription: {
        plan: planId,
        planName: plan.name,
        expiresAt: result.owner?.subscriptionEndsAt,
      }
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('Verify payment error:', error);
    return NextResponse.json(
      { error: 'Payment verification failed' },
      { status: 500, headers: corsHeaders }
    );
  }
}
