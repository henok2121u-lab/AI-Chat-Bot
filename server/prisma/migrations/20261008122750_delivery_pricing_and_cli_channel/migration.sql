/*
  Warnings:

  - Added the required column `subtotal` to the `Order` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "Channel" ADD VALUE 'CLI';

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "deliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "freeDeliveryThreshold" DECIMAL(10,2),
ADD COLUMN     "minDeliveryOrder" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "subtotal" DECIMAL(10,2) NOT NULL;
