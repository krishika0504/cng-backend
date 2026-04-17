import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const owners = await prisma.stationOwner.findMany({
    where: {
      subscriptionType: { not: null },
      subscriptionEndsAt: { not: null },
    },
    select: {
      id: true,
      subscriptionType: true,
      subscriptionEndsAt: true,
      stations: {
        select: { id: true },
      },
    },
  });

  let inserted = 0;

  for (const owner of owners) {
    const stationIds = owner.stations.map((station) => station.id);
    if (stationIds.length === 0 || !owner.subscriptionType || !owner.subscriptionEndsAt) {
      continue;
    }

    await prisma.subscription.updateMany({
      where: {
        stationId: { in: stationIds },
        status: 'active',
      },
      data: { status: 'expired' },
    });

    const now = new Date();
    const rows = stationIds.map((stationId) => ({
      stationId,
      planType: owner.subscriptionType as string,
      startDate: now,
      endDate: owner.subscriptionEndsAt as Date,
      amount: 0,
      status: 'active',
    }));

    const result = await prisma.subscription.createMany({ data: rows });
    inserted += result.count;
  }

  console.log(JSON.stringify({ owners: owners.length, inserted }));
}

main()
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
