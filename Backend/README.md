# Madrastak Backend

## Production environment

The backend reads these values from the server environment through `dotenv` and [db.js](db.js):

```text
DB_HOST
DB_PORT
DB_USER
DB_PASSWORD
DB_NAME
JWT_SECRET
```

For JaaS classroom access, configure the existing server-side key mechanism as needed:

```text
JAAS_APP_ID
JAAS_KEY_ID or JAAS_KID
JAAS_PRIVATE_KEY, JAAS_PRIVATE_KEY_BASE64, or JAAS_PRIVATE_KEY_PATH
```

Never commit any of these values. `Backend/.env` and all `.env*` variants are ignored by Git.

## Database setup

Run the idempotent migration before starting the server:

```bash
npm run migrate
```

Existing users receive `account_status = active`. New public teacher registrations are created as `pending`; student registrations are `active`.

## Seed the administrator

Provide administrator credentials only through the server environment. Never commit them or expose them to the browser:

```text
ADMIN_EMAIL=your-admin-email
ADMIN_PASSWORD=use-a-long-random-password
ADMIN_NAME=your-admin-display-name
```

Then run:

```bash
npm run seed:admin
```

The same seed logic is also invoked once during backend startup when `ADMIN_EMAIL` and `ADMIN_PASSWORD` are present. If they are absent, normal startup continues without creating an admin. The bootstrap hashes the password with bcrypt, creates an active admin only when no admin exists, records completion in `admin_bootstrap`, and refuses to promote an existing non-admin account. Existing admin credentials are never changed by rerunning the command.
