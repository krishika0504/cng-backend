import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import Razorpay from 'razorpay';
import { prisma } from '@/lib/prisma';
import { verifyJwt } from '@/lib/auth';
import { corsHeaders } from '@/lib/api-utils';

const orderSchema = z.object({
  planId: z.enum(['basic', 'standard', 'premium', 'trial']),
});

const planDetails = {
  basic: { name: 'Basic', price: 999, duration: 30 },
  standard: { name: 'Standard', price: 2499, duration: 30 },
  premium: { name: 'Premium', price: 4999, duration: 30 },
  trial: { name: '7-Day Trial', price: 1, duration: 7 },
};

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
    const validation = orderSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid plan selected' },
        { status: 400, headers: corsHeaders }
      );
    }

    const { planId } = validation.data;
    const plan = planDetails[planId];

    // Get owner details
    const owner = await prisma.stationOwner.findUnique({
      where: { id: payload.userId },
      select: {
        name: true,
        email: true,
        phone: true,
      },
    });

    if (!owner) {
      return NextResponse.json(
        { error: 'Owner not found' },
        { status: 404, headers: corsHeaders }
      );
    }

    // Initialize Razorpay instance
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      throw new Error('Razorpay credentials not configured');
    }

    const razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });

    // Create Razorpay order
    const amount = plan.price * 100; // Amount in paise
    const razorpayOrder = await razorpay.orders.create({
      amount,
      currency: 'INR',
      receipt: `receipt_${Date.now()}`,
      notes: {
        planId,
        ownerId: payload.userId,
        ownerEmail: owner.email,
      },
    });

    // Create payment history record (pending)
    // Debug: Check if paymentHistory exists on prisma
    if (!prisma.paymentHistory) {
      console.error('Available prisma models:', Object.keys(prisma).filter(k => k[0] === k[0].toLowerCase()));
      throw new Error('PaymentHistory model not found on Prisma client. Please restart the server.');
    }

    await prisma.paymentHistory.create({
      data: {
        ownerId: payload.userId,
        razorpayOrderId: razorpayOrder.id,
        planId,
        planName: plan.name,
        amount: plan.price,
        currency: 'INR',
        status: 'pending',
      },
    });

    return NextResponse.json({
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      ownerName: owner.name,
      ownerEmail: owner.email,
      ownerPhone: owner.phone,
      keyId: process.env.RAZORPAY_KEY_ID,
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('Create order error:', error);
    return NextResponse.json(
      { error: 'Failed to create order' },
      { status: 500, headers: corsHeaders }
    );
  }
}
