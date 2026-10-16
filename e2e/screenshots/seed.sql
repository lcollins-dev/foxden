-- The household the README screenshots show. Run against a freshly cleaned instance database, whose test admin
-- becomes Alex Morgan with the same password.
UPDATE "user"
SET "name" = 'Alex Morgan', "email" = 'alex@example.com', "normalizedEmail" = 'alex@example.com'
WHERE "normalizedEmail" = 'admin@foxden.test';

INSERT INTO "user" ("uid", "name", "email", "normalizedEmail", "authSalt", "verifyHash", "wrapWrapKb", "clientSalt",
  "kA", "verifierSetAt", "keysChangedAt", "enabled", "lastLoginSuccess")
SELECT lower(hex(randomblob(16))), "name", "email", "email", '', '', '', '', '', 0, 0, 1,
  strftime('%Y-%m-%d %H:%M:%f', 'now')
FROM (
  SELECT 'Jordan Lee' AS "name", 'jordan@example.com' AS "email"
  UNION ALL SELECT 'Riley Evans', 'riley@example.com'
  UNION ALL SELECT 'Sam Carter', 'sam@example.com'
);

-- Both admin roles, as the test admin has.
INSERT INTO "user_user_role" ("userId", "userRoleId")
SELECT "id", "roleId" FROM "user", (SELECT 9100 AS "roleId" UNION SELECT 9200)
WHERE "normalizedEmail" = 'jordan@example.com';

-- The newest invite lists first, so Morgan goes in last.
INSERT INTO "invite" ("tokenHash", "email", "name", "admin", "expiresAt", "createdAt")
VALUES
  (lower(hex(randomblob(32))), 'casey@example.com', 'Casey Brooks', 0,
    unixepoch('now', '+7 days') * 1000, unixepoch('now') * 1000),
  (lower(hex(randomblob(32))), 'morgan@example.com', 'Morgan Hayes', 0,
    unixepoch('now', '+7 days') * 1000, unixepoch('now') * 1000);

-- Alex's three Firefoxes. A session with a device is a Firefox signed in to Sync. The newest session lists first,
-- so the iPad goes in last.
CREATE TEMP TABLE "firefox" ("position" integer, "name" text, "type" text, "userAgent" text);
INSERT INTO "firefox" VALUES
  (1, 'Alex’s Firefox on desktop-alex', 'desktop',
    'Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0'),
  (2, 'Alex’s Firefox on Pixel 8', 'mobile',
    'Mozilla/5.0 (Android 16; Mobile; rv:157.0) Gecko/157.0 Firefox/157.0'),
  (3, 'Alex’s Firefox on iPad', 'tablet',
    'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/157.0 Mobile/15E148 Safari/605.1.15');

INSERT INTO "session" ("tokenIdHash", "userId", "userAgent", "createdAt", "lastAccessAt", "authAt")
SELECT lower(hex(randomblob(32))), "user"."id", "firefox"."userAgent",
  unixepoch('now') * 1000, unixepoch('now') * 1000, unixepoch('now') * 1000
FROM "firefox", "user"
WHERE "user"."normalizedEmail" = 'alex@example.com'
ORDER BY "firefox"."position";

INSERT INTO "device" ("id", "userId", "sessionId", "name", "type", "pushEndpointExpired", "availableCommandsJson",
  "createdAt", "lastAccessAt")
SELECT lower(hex(randomblob(16))), "session"."userId", "session"."id", "firefox"."name", "firefox"."type", 0, '{}',
  "session"."createdAt", "session"."lastAccessAt"
FROM "session" JOIN "firefox" ON "firefox"."userAgent" = "session"."userAgent";
