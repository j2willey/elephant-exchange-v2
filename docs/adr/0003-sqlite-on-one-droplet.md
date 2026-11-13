# SQLite, not Postgres

The service runs as a single Node process on one DigitalOcean droplet, and expected load is a handful of Games at once. SQLite (accessed through Drizzle) is a single file with nothing extra to run, and backups are a file copy. Postgres was considered for its room to grow (several servers, heavy concurrent writes) and its value on a resume, but neither need exists yet and it adds a container to run and back up. If the service ever needs more than one server, moving to Postgres is the planned path; Drizzle supports both, though the move is not free.
