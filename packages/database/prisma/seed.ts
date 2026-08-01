import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const store = await prisma.store.upsert({
    where: { shopDomain: 'demo.myshopify.com' },
    update: {},
    create: {
      shopDomain: 'demo.myshopify.com',
      accessToken: 'shpat_demo_encrypted_placeholder',
      scopes: ['read_content', 'write_content'],
    },
  });
  console.log(`Seeded store ${store.shopDomain}`);
}

main()
  .catch((error) => {
    console.error('Seed failed', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
