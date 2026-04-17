import { Prisma, PrismaClient } from '@prisma/client';

type ReferralDb = PrismaClient | Prisma.TransactionClient | any;

export async function generateUniqueReferralCode(db: ReferralDb): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = `CNG${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const existing = await db.user.findFirst({
      where: { referralCode: code },
      select: { id: true },
    });

    if (!existing) {
      return code;
    }
  }

  throw new Error('Unable to generate unique referral code');
}

export async function applyReferralCommission(
  tx: ReferralDb,
  refereeUserId: string,
  planType: string,
  planPriceRupees: number
): Promise<{ commissionPaise: number; referrerId: string } | null> {
  // Paid plans only.
  if (planType === 'free_trial' || planPriceRupees <= 0) {
    return null;
  }

  const referral = await tx.referral.findUnique({
    where: { refereeId: refereeUserId },
    select: {
      id: true,
      referrerId: true,
      status: true,
    },
  });

  if (!referral || referral.status !== 'pending') {
    return null;
  }

  if (referral.referrerId === refereeUserId) {
    return null;
  }

  const planAmountPaise = Math.round(planPriceRupees * 100);
  const commissionPaise = Math.floor((planAmountPaise * 25) / 100);

  await tx.user.update({
    where: { id: referral.referrerId },
    data: {
      referralWalletPaise: { increment: commissionPaise },
      referralLifetimeEarnedPaise: { increment: commissionPaise },
      referralCount: { increment: 1 },
    },
  });

  await tx.referral.update({
    where: { id: referral.id },
    data: {
      status: 'rewarded',
      planType,
      planAmountPaise,
      commissionRate: 25,
      commissionPaise,
      rewardedAt: new Date(),
    },
  });

  return {
    commissionPaise,
    referrerId: referral.referrerId,
  };
}
