import { prisma } from '@/lib/prisma';

export interface SubscriptionActivationResult {
  success: boolean;
  owner?: {
    id: string;
    subscriptionType: string | null;
    subscriptionEndsAt: Date | null;
  };
  error?: string;
}

const planDetails = {
  basic: { name: 'Basic', price: 999, duration: 30 },
  standard: { name: 'Standard', price: 2499, duration: 30 },
  premium: { name: 'Premium', price: 4999, duration: 30 },
  trial: { name: '7-Day Trial', price: 1, duration: 7 },
};

/**
 * Activate subscription for a station owner after successful payment
 * This function is idempotent - calling it multiple times with the same payment won't create duplicates
 * 
 * @param ownerId - The station owner's ID
 * @param planId - The subscription plan (basic, standard, premium, or trial)
 * @param razorpayOrderId - The Razorpay order ID
 * @param razorpayPaymentId - The Razorpay payment ID
 * @param razorpaySignature - The Razorpay signature (optional, for logging)
 * @returns Result indicating success or failure
 */
export async function activateSubscription(
  ownerId: string,
  planId: 'basic' | 'standard' | 'premium' | 'trial',
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature?: string
): Promise<SubscriptionActivationResult> {
  try {
    // Validate plan
    const plan = planDetails[planId];
    if (!plan) {
      return {
        success: false,
        error: `Invalid plan: ${planId}`,
      };
    }

    // Check if payment already processed (idempotency check)
    const existingPayment = await prisma.paymentHistory.findUnique({
      where: { razorpayOrderId },
    });

    if (!existingPayment) {
      return {
        success: false,
        error: 'Payment record not found',
      };
    }

    if (existingPayment.status === 'success') {
      // Payment already processed, return existing subscription
      const owner = await prisma.stationOwner.findUnique({
        where: { id: ownerId },
        select: {
          id: true,
          subscriptionType: true,
          subscriptionEndsAt: true,
        },
      });

      return {
        success: true,
        owner: owner || undefined,
      };
    }

    // Calculate subscription dates
    const now = new Date();
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + plan.duration);

    // Persist subscription state consistently across owner, payment history, and station subscriptions.
    const owner = await prisma.$transaction(async (tx) => {
      const updatedOwner = await tx.stationOwner.update({
        where: { id: ownerId },
        data: {
          subscriptionType: planId,
          subscriptionEndsAt: expiryDate,
        },
        select: {
          id: true,
          subscriptionType: true,
          subscriptionEndsAt: true,
        },
      });

      await tx.paymentHistory.update({
        where: { razorpayOrderId },
        data: {
          razorpayPaymentId,
          razorpaySignature: razorpaySignature || null,
          status: 'success',
          subscriptionStartsAt: now,
          subscriptionEndsAt: expiryDate,
        },
      });

      const ownerStations = await tx.station.findMany({
        where: { ownerId },
        select: { id: true },
      });

      if (ownerStations.length > 0) {
        await tx.subscription.updateMany({
          where: {
            stationId: { in: ownerStations.map((station) => station.id) },
            status: 'active',
          },
          data: { status: 'expired' },
        });

        await tx.subscription.createMany({
          data: ownerStations.map((station) => ({
            stationId: station.id,
            planType: planId,
            startDate: now,
            endDate: expiryDate,
            amount: plan.price,
            status: 'active',
          })),
        });
      }

      return updatedOwner;
    });

    // Create activity log
    await prisma.activityLog.create({
      data: {
        ownerId,
        action: 'subscription_purchased',
        description: `Purchased ${plan.name} plan for ₹${plan.price}`,
        metadata: JSON.stringify({
          planId,
          amount: plan.price,
          payment_id: razorpayPaymentId,
          order_id: razorpayOrderId,
        }),
      },
    });

    // Create notification
    await prisma.notification.create({
      data: {
        ownerId,
        title: 'Subscription Activated',
        message: `Your ${plan.name} plan is now active! Valid until ${expiryDate.toLocaleDateString()}`,
        type: 'success',
        category: 'subscription',
      },
    });

    return {
      success: true,
      owner,
    };
  } catch (error) {
    console.error('Error activating subscription:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Get plan details by plan ID
 */
export function getPlanDetails(planId: 'basic' | 'standard' | 'premium' | 'trial') {
  return planDetails[planId];
}
