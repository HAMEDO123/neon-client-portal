-- The team chat now looks like a WhatsApp group, with its name at the top.
-- "Team" was a placeholder; this names it once and leaves any other name alone.
UPDATE "ChatChannel" SET "name" = 'NEON Team' WHERE "key" = 'team' AND "name" = 'Team';
