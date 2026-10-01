-- `quantity` was free text ("2 boxes"); the studio asked for a number instead.
--
-- DROP COLUMN destroys what is in it. It is safe here because there is
-- nothing in it: SupplyRequestLine was created the day before this and no
-- row had been written on any database when this was generated — checked on
-- the live one, which held 0 lines against 3 requests from before the table
-- existed. Anything else would have needed the values carried across first.

-- AlterTable
ALTER TABLE "SupplyRequestLine" DROP COLUMN "quantity",
ADD COLUMN     "count" INTEGER;
